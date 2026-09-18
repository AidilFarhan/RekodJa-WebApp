import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const values = [body.spreadsheetId, body.spreadsheetName, body.sheetName];
  if (values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 255)) return NextResponse.json({ error: 'Invalid spreadsheet selection.' }, { status: 400 });
  const { data, error } = await client.from('sheet_connections').upsert({
    user_id: user.id,
    spreadsheet_id: body.spreadsheetId.trim(),
    spreadsheet_name: body.spreadsheetName.trim(),
    sheet_name: body.sheetName.trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,spreadsheet_id,sheet_name' }).select('id').single();
  if (error) return NextResponse.json({ error: 'Could not save tracker connection.' }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
