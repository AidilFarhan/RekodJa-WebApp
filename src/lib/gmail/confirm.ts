import type { Stage } from '../dashboard.ts';
import type { supabase } from '../supabase.ts';
import { writeStageToSheet } from '../sheets/sync.ts';

type Client = Awaited<ReturnType<typeof supabase>>;

export type ConfirmOutcome =
  | { ok: true; applicationId: string; stage: string; eventType: string; sheet: { synced: boolean; message?: string } | null }
  | { ok: false; error: string };

/*
 * The write path for a reviewed candidate, shared by the manual confirm route
 * and scan-time auto-confirm. One deliberate sequence, identical everywhere:
 *   - record a 'user_confirmed' application_event,
 *   - update the application stage when it differs,
 *   - mark the candidate 'dismissed' (leaves every list),
 *   - sync the stage to the connected Google Sheet when possible.
 */
export async function confirmCandidate(
  client: Client,
  userId: string,
  token: string,
  input: { messageId: string; applicationId: string; stage: Stage },
): Promise<ConfirmOutcome> {
  const { messageId, applicationId, stage } = input;

  const { data: candidate, error: candidateError } = await client
    .from('gmail_scan_candidates')
    .select('id, message_id, event_type, matched_application_id')
    .eq('user_id', userId)
    .eq('message_id', messageId)
    .maybeSingle();
  if (candidateError) return { ok: false, error: 'Could not load the scan result.' };
  if (!candidate) return { ok: false, error: 'This scan result is no longer available. Scan again.' };

  const { data: existing, error: existingError } = await client
    .from('applications')
    .select('id, stage, sheet_connection_id, import_key, company, role, date_applied, job_url')
    .eq('id', applicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) return { ok: false, error: 'Could not load the application.' };
  if (!existing) return { ok: false, error: 'Application not found.' };

  const previousStage = existing.stage;
  const eventType = candidate.event_type ?? 'stage_observation';
  const { error: eventError } = await client.from('application_events').insert({
    user_id: userId,
    application_id: applicationId,
    event_status: 'user_confirmed',
    event_type: eventType,
    from_stage: previousStage,
    to_stage: stage,
    source: 'gmail_scan',
  });
  if (eventError) return { ok: false, error: 'Could not record the event.' };

  if (existing.stage !== stage) {
    const { error: updateError } = await client
      .from('applications')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', applicationId)
      .eq('user_id', userId);
    if (updateError) return { ok: false, error: 'Could not update the stage.' };
  }

  await client
    .from('gmail_scan_candidates')
    .update({ review_state: 'dismissed', confirmed_stage: stage, updated_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('user_id', userId);

  let sheet: { synced: boolean; message?: string } | null = null;
  if (existing.sheet_connection_id) {
    const { data: connection } = await client
      .from('sheet_connections')
      .select('spreadsheet_id, sheet_name')
      .eq('id', existing.sheet_connection_id)
      .maybeSingle();
    sheet = connection
      ? await writeStageToSheet({
          token,
          connection,
          application: {
            import_key: existing.import_key,
            company: existing.company,
            role: existing.role,
            date_applied: existing.date_applied,
            job_url: existing.job_url,
          },
          stage,
        })
      : null;
  }

  return { ok: true, applicationId, stage, eventType, sheet };
}

/*
 * Auto-confirm eligibility: everything the scanner can produce is present and
 * exactly one application is bound. A stage guessed by the model still counts
 * as "present" — the user asked for automation and corrects mistakes on the
 * application page afterwards.
 */
export function autoConfirmEligible(candidate: {
  match: { applicationId: string } | null;
  suggested: { company: string; role: string; status: string };
}): boolean {
  return Boolean(
    candidate.match?.applicationId &&
    candidate.suggested.company &&
    candidate.suggested.role &&
    candidate.suggested.status,
  );
}

/*
 * Pipeline ranks so an email can never regress a stage the user already set
 * (e.g. a stale "application received" ack demoting an Interview back to
 * Applied). Terminal stages rank highest.
 */
function stageRank(stage: string): number {
  if (stage === 'Applied') return 1;
  if (stage === 'Interview') return 2;
  if (stage === 'Offer') return 3;
  return 4;
}

export type AutoAction = 'confirm' | 'dismiss-only' | 'skip';

/*
 * What scan-time auto handling should do for a matched candidate.
 *   confirm       — the email moves the application FORWARD: apply it.
 *   dismiss-only  — same or earlier stage: the email is stale/redundant;
 *                   dismiss it without touching the application or the Sheet.
 *   skip          — missing data: leave it for manual review.
 */
export function autoConfirmAction(currentStage: string, suggestedStage: string): AutoAction {
  if (!currentStage || !suggestedStage) return 'skip';
  return stageRank(suggestedStage) > stageRank(currentStage) ? 'confirm' : 'dismiss-only';
}
