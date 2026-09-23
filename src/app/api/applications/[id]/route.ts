import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { stages, type Stage } from '@/lib/dashboard';
import { writeDateAppliedToSheet, writeStageToSheet } from '@/lib/sheets/sync';
import { rowIdentityKey } from '@/lib/sheets/import';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  let body: { stage?: string; dateApplied?: string } = {};
  try { body = await request.json(); } catch { /* keep defaults */ }
  const nextStage = stages.includes(body.stage as Stage) ? (body.stage as Stage) : null;
  const dateWasRequested = Object.hasOwn(body, 'dateApplied');
  const nextDateApplied = typeof body.dateApplied === 'string' ? body.dateApplied : null;
  const parsedDate = nextDateApplied ? new Date(`${nextDateApplied}T00:00:00Z`) : null;
  const validDate = nextDateApplied !== null && /^\d{4}-\d{2}-\d{2}$/.test(nextDateApplied) && parsedDate?.toISOString().slice(0, 10) === nextDateApplied;
  if (!nextStage && !dateWasRequested) return NextResponse.json({ error: 'A valid stage or date is required.' }, { status: 400 });
  if (nextStage && dateWasRequested) return NextResponse.json({ error: 'Update the stage and date separately.' }, { status: 400 });
  if (dateWasRequested && !validDate) return NextResponse.json({ error: 'Please enter a valid date applied.' }, { status: 400 });
  const { data: application, error: applicationError } = await client
    .from('applications')
    .select('id, stage, sheet_connection_id, import_key, company, role, date_applied, job_url')
    .eq('id', id)
    .maybeSingle();
  if (applicationError) return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  const stageChanged = Boolean(nextStage && application.stage !== nextStage);
  const dateChanged = Boolean(dateWasRequested && application.date_applied !== nextDateApplied);
  if (!stageChanged && !dateChanged) return NextResponse.json({ ok: true, stage: application.stage, dateApplied: application.date_applied, sheet: null });
  const updates: { stage?: Stage; date_applied?: string; updated_at: string } = { updated_at: new Date().toISOString() };
  if (stageChanged) updates.stage = nextStage!;
  if (dateChanged) updates.date_applied = nextDateApplied!;
  const { error: updateError } = await client.from('applications').update(updates).eq('id', id).eq('user_id', user.id);
  if (updateError) return NextResponse.json({ error: 'Could not update the application.' }, { status: 500 });
  if (stageChanged) {
    await client.from('application_events').insert({ application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'stage_change', from_stage: application.stage, to_stage: nextStage!, source: 'manual' });
  }
  let sheet: { synced: boolean; message?: string } | null = null;
  let connection: { spreadsheet_id: string; sheet_name: string } | null = null;
  if (application.sheet_connection_id) {
    const { data, error: connectionError } = await client.from('sheet_connections').select('spreadsheet_id, sheet_name').eq('id', application.sheet_connection_id).maybeSingle();
    connection = data;
    sheet = connectionError || !connection
      ? { synced: false, message: 'The connected tracker could not be found.' }
      : stageChanged
        ? await writeStageToSheet({ token, connection, application, stage: nextStage! })
        : await writeDateAppliedToSheet({ token, connection, application, nextDateApplied: nextDateApplied! });
  }
  // An imported row's stable key includes its date. Refresh it only after the
  // corresponding Sheet cell succeeded, so future imports still recognise the
  // same row and cannot create a duplicate application.
  if (dateChanged && sheet?.synced && connection && application.import_key) {
    await client.from('applications').update({
      import_key: rowIdentityKey({
        spreadsheetId: connection.spreadsheet_id,
        sheetName: connection.sheet_name,
        company: application.company,
        role: application.role,
        dateApplied: nextDateApplied!,
        jobUrl: application.job_url,
      }),
    }).eq('id', id).eq('user_id', user.id);
  }
  return NextResponse.json({ ok: true, stage: nextStage ?? application.stage, dateApplied: nextDateApplied ?? application.date_applied, sheet });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  await client.from('application_events').delete().eq('application_id', id).eq('user_id', user.id);
  const { data: deleted, error } = await client.from('applications').delete().eq('id', id).eq('user_id', user.id).select('id');
  if (error) return NextResponse.json({ error: 'Could not delete the application.' }, { status: 500 });
  if (!deleted || deleted.length === 0) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
