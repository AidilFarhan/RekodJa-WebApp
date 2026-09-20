import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { stages, type Stage } from '@/lib/dashboard';
import { writeStageToSheet } from '@/lib/sheets/sync';

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
 *   - marks the candidate 'confirmed',
 *   - and syncs the stage back to the connected Google Sheet when possible.
 */
export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

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
  let applicationId: string | null = null;
  let application: ConfirmedApplication | null = null;
  let previousStage: string | null = null;

  if (requestedApplicationId) {
    const { data: existing, error: existingError } = await client
      .from('applications')
      .select('id, stage, sheet_connection_id, import_key, company, role, date_applied, job_url')
      .eq('id', requestedApplicationId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 });
    if (!existing) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    application = existing as ConfirmedApplication;
    applicationId = existing.id;
    previousStage = existing.stage;
  } else {
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
      .select('id, stage, sheet_connection_id, import_key, company, role, date_applied, job_url')
      .single();
    if (createError || !created) return NextResponse.json({ error: 'Could not create the application.' }, { status: 400 });
    application = created as ConfirmedApplication;
    applicationId = created.id;
  }

  if (!application) return NextResponse.json({ error: 'Could not resolve the application.' }, { status: 500 });

  const eventType = candidate.event_type ?? 'stage_observation';
  const { error: eventError } = await client.from('application_events').insert({
    user_id: user.id,
    application_id: applicationId,
    event_status: 'user_confirmed',
    event_type: eventType,
    from_stage: previousStage,
    to_stage: stage,
    source: 'gmail_scan',
  });
  if (eventError) return NextResponse.json({ error: 'Could not record the event.' }, { status: 500 });

  if (application.stage !== stage) {
    const { error: updateError } = await client
      .from('applications')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', applicationId)
      .eq('user_id', user.id);
    if (updateError) return NextResponse.json({ error: 'Could not update the stage.' }, { status: 500 });
  }

  await client
    .from('gmail_scan_candidates')
    .update({ review_state: 'confirmed', confirmed_stage: stage, updated_at: new Date().toISOString() })
    .eq('id', candidate.id)
    .eq('user_id', user.id);

  // Optional: sync the stage back to the connected Google Sheet.
  let sheet: { synced: boolean; message?: string } | null = null;
  if (application.sheet_connection_id) {
    const { data: connection } = await client
      .from('sheet_connections')
      .select('spreadsheet_id, sheet_name')
      .eq('id', application.sheet_connection_id)
      .maybeSingle();
    sheet = connection
      ? await writeStageToSheet({
          token,
          connection,
          application: {
            import_key: application.import_key,
            company: application.company,
            role: application.role,
            date_applied: application.date_applied,
            job_url: application.job_url,
          },
          stage,
        })
      : null;
  }

  return NextResponse.json({ ok: true, applicationId, stage, eventType, sheet });
}
