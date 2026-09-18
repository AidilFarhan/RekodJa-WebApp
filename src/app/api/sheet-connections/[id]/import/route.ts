import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseSheetRows } from '@/lib/sheets/import';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Google authorization required.' }, { status: 400 });
  const { id } = await params;
  const { data: connection, error: connectionError } = await client.from('sheet_connections').select('id, spreadsheet_id, sheet_name').eq('id', id).single();
  if (connectionError || !connection) return NextResponse.json({ error: 'Tracker connection not found.' }, { status: 404 });
  const range = `'${connection.sheet_name.replaceAll("'", "''")}'!A:G`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(connection.spreadsheet_id)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const googleResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!googleResponse.ok) return NextResponse.json({ error: 'Google could not read the connected sheet. Reconnect access and try again.' }, { status: 502 });
  const sheet = await googleResponse.json();
  const parsed = parseSheetRows(sheet.values ?? [], connection.spreadsheet_id, connection.sheet_name);
  let created = 0, updated = 0, stageChanged = 0;
  const databaseErrors: string[] = [];
  for (const row of parsed.rows) {
    const { data, error } = await client.rpc('import_sheet_application', {
      p_connection_id: connection.id,
      p_import_key: row.importKey,
      p_company: row.company,
      p_role: row.role,
      p_stage: row.stage,
      p_date_applied: row.dateApplied,
      p_source: row.source,
      p_job_url: row.jobUrl,
      p_replied: row.replied,
    });
    if (error) { databaseErrors.push(`${row.company} — ${row.role}`); continue; }
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.created) created += 1; else updated += 1;
    if (!result?.created && result?.stage_changed) stageChanged += 1;
  }
  if (databaseErrors.length) return NextResponse.json({ error: `Import stopped for ${databaseErrors.length} row(s). No duplicates were created; fix the rows and retry.` }, { status: 400 });
  await client.from('import_issues').delete().eq('sheet_connection_id', id);
  const issues = [...parsed.errors, ...parsed.warnings];
  if (issues.length) {
    await client.from('import_issues').insert(issues.map((message) => ({ sheet_connection_id: id, user_id: user.id, message })));
  }
  return NextResponse.json({ created, updated, stageChanged, skipped: parsed.errors.length, skippedDetails: parsed.errors, warnings: parsed.warnings });
}
