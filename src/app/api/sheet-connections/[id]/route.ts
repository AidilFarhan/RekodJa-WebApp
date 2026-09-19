import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  let body: { spreadsheetId?: string; spreadsheetName?: string; sheetName?: string } = {};
  try { body = await request.json(); } catch { /* keep defaults */ }
  const spreadsheetId = (body.spreadsheetId ?? '').trim();
  const spreadsheetName = (body.spreadsheetName ?? '').trim();
  const sheetName = (body.sheetName ?? '').trim();
  if (!spreadsheetId || !spreadsheetName || !sheetName) return NextResponse.json({ error: 'Spreadsheet id, name and sheet name are required.' }, { status: 400 });
  const { data: existing } = await client.from('sheet_connections').select('id').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Tracker connection not found.' }, { status: 404 });
  // One tracker per account: remove any other saved connections first so the
  // replacement cannot collide with a stale row.
  await client.from('sheet_connections').delete().eq('user_id', user.id).neq('id', id);
  const { data: updated, error } = await client
    .from('sheet_connections')
    .update({ spreadsheet_id: spreadsheetId, spreadsheet_name: spreadsheetName, sheet_name: sheetName })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .single();
  if (error || !updated) return NextResponse.json({ error: 'Tracker connection not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, id: updated.id });
}
