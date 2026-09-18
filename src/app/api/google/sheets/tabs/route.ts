import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const { spreadsheetId } = await request.json().catch(() => ({}));
  if (!token || typeof spreadsheetId !== 'string' || !spreadsheetId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`;
  const googleResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!googleResponse.ok) return NextResponse.json({ error: 'Google could not open that spreadsheet. Check the selected file and permission.' }, { status: 502 });
  const data = await googleResponse.json();
  return NextResponse.json({ title: data.properties?.title ?? '', tabs: (data.sheets ?? []).map((sheet: { properties?: { title?: string } }) => sheet.properties?.title).filter(Boolean) });
}
