import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

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
