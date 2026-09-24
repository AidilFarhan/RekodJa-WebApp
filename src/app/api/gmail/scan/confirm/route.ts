import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { gmailAccessError } from '@/lib/billing/server';
import { stages, type Stage } from '@/lib/dashboard';
import { confirmCandidate } from '@/lib/gmail/confirm';

export const runtime = 'nodejs';

type ConfirmedApplication = {
  id: string;
  stage: string;
  sheet_connection_id: string | null;
  import_key: string | null;
  company: string;
  role: string;
  date_applied: string | null;
  job_url: string;
};
/*
 * POST /api/gmail/scan/confirm — review step.
 *
 * Confirms one scan candidate in a single deliberate action:
 *   - records a 'user_confirmed' application_event (stage_observation or
 *     employer_response),
 *   - updates the application stage (or creates a new application for an
 *     unmatched email),
 *   - marks the candidate 'dismissed' — review_state leaves 'pending', so the
 *     item leaves every list. Both review paths end here (REQUESTED FLOW):
 *     existing application = update + dismiss, new application = create + dismiss.
 *   - and syncs the stage back to the connected Google Sheet when possible.
 */
export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const accessError = await gmailAccessError(client, user);
  if (accessError) return accessError;

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const body = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    applicationId?: string | null;
    company?: string;
    role?: string;
    stage?: string;
    sender?: string;
    threadLink?: string;
    dateApplied?: string;
    createOnly?: boolean;
  };

  const messageId = String(body.messageId ?? '').trim();
  const company = String(body.company ?? '').trim().slice(0, 200);
  const role = String(body.role ?? '').trim().slice(0, 200);
  const createOnly = body.createOnly === true;
  const stage = stages.includes(body.stage as Stage) ? (body.stage as Stage) : null;
  if (!messageId) {
    return NextResponse.json({ error: 'Message id is required.' }, { status: 400 });
  }
  if (!createOnly && !stage) {
    return NextResponse.json({ error: 'Message id and a valid stage are required.' }, { status: 400 });
  }

  const { data: candidate, error: candidateError } = await client
    .from('gmail_scan_candidates')
    .select('id, message_id, event_type, matched_application_id')
    .eq('user_id', user.id)
    .eq('message_id', messageId)
    .maybeSingle();
  if (candidateError) return NextResponse.json({ error: 'Could not load the scan result.' }, { status: 500 });
  if (!candidate) return NextResponse.json({ error: 'This scan result is no longer available. Scan again.' }, { status: 404 });

  /*
   * Two-step unmatched flow: createOnly only creates the application
   * (stage 'Applied', no event, no sheet write). The suggested stage is
   * then confirmed in a separate, deliberate confirm call.
   */
  if (createOnly) {
    if (!company || !role) {
      return NextResponse.json({ error: 'Company and role are required for a new application.' }, { status: 400 });
    }
    const dateApplied = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateApplied ?? '')) ? body.dateApplied : null;
    const { data: created, error: createError } = await client
      .from('applications')
      .insert({
        user_id: user.id,
        company,
        role,
        stage: 'Applied',
        source: 'Other',
        job_url: String(body.threadLink ?? '').slice(0, 2048),
        date_applied: dateApplied,
      })
      .select('id')
      .single();
    if (createError || !created) {
      return NextResponse.json({ error: 'Could not create the application.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, created: true, id: created.id });
  }

  if (!stage) {
    return NextResponse.json({ error: 'Message id and a valid stage are required.' }, { status: 400 });
  }

  const requestedApplicationId = body.applicationId ?? candidate.matched_application_id ?? null;
  // Company and role are only required when creating a new application;
  // updating an existing one only changes the stage.
  if (!requestedApplicationId && (!company || !role)) {
    return NextResponse.json({ error: 'Company and role are required for a new application.' }, { status: 400 });
  }

  let applicationId = requestedApplicationId;
  if (!applicationId) {
    const dateApplied = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateApplied ?? '')) ? body.dateApplied : null;
    const { data: created, error: createError } = await client
      .from('applications')
      .insert({
        user_id: user.id,
        company,
        role,
        stage,
        source: 'Other',
        job_url: String(body.threadLink ?? '').slice(0, 2048),
        date_applied: dateApplied,
      })
      .select('id')
      .single();
    if (createError || !created) {
      return NextResponse.json({ error: 'Could not create the application.' }, { status: 400 });
    }
    applicationId = created.id;
  }

  const outcome = await confirmCandidate(client, user.id, token, { messageId, applicationId, stage });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 400 });
  return NextResponse.json({ ok: true, applicationId: outcome.applicationId, stage: outcome.stage, eventType: outcome.eventType, sheet: outcome.sheet });
}
