import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const values = [body.spreadsheetId, body.spreadsheetName, body.sheetName];
  if (values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 255)) return NextResponse.json({ error: 'Invalid spreadsheet selection.' }, { status: 400 });
  const connection = {
    spreadsheet_id: body.spreadsheetId.trim(),
    spreadsheet_name: body.spreadsheetName.trim(),
    sheet_name: body.sheetName.trim(),
    updated_at: new Date().toISOString(),
  };
  // One tracker per account. Reconnecting replaces the saved connection in
  // place (keeping its id so imported applications stay linked) and removes
  // any stale extra connections before the new selection is saved.
  const { data: existing } = await client.from('sheet_connections').select('id').eq('user_id', user.id).order('created_at').limit(1);
  if (existing && existing.length > 0) {
    const keptId = existing[0].id;
    await client.from('sheet_connections').delete().eq('user_id', user.id).neq('id', keptId);
    const { data: updated, error } = await client
      .from('sheet_connections')
      .update(connection)
      .eq('id', keptId)
      .eq('user_id', user.id)
      .select('id')
      .single();
    if (error || !updated) return NextResponse.json({ error: 'Could not save tracker connection.' }, { status: 400 });
    return NextResponse.json(updated, { status: 200 });
  }
  const { data, error } = await client.from('sheet_connections').insert({ user_id: user.id, ...connection }).select('id').single();
  if (error) return NextResponse.json({ error: 'Could not save tracker connection.' }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
