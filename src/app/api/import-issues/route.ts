import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function DELETE() {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { error } = await client.from('import_issues').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Could not dismiss notifications.' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
