import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  let applicationIds: string[] = [];
  try { applicationIds = (await request.json()).applicationIds ?? []; } catch { /* empty */ }
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) return NextResponse.json({ ok: true, removed: 0 });
  await client.from('application_events').delete().in('application_id', applicationIds).eq('user_id', user.id);
  const { data: deleted, error } = await client
    .from('applications')
    .delete()
    .in('id', applicationIds)
    .eq('sheet_connection_id', id)
    .eq('user_id', user.id)
    .select('id');
  if (error) return NextResponse.json({ error: 'Could not remove the applications.' }, { status: 500 });
  return NextResponse.json({ ok: true, removed: deleted?.length ?? 0 });
}
