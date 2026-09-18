import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  const { data: application, error: applicationError } = await client.from('applications').select('id').eq('id', id).maybeSingle();
  if (applicationError) return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  const { data: event, error: insertError } = await client
    .from('application_events')
    .insert({ application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'follow_up_completed', source: 'manual', from_stage: null, to_stage: null })
    .select('id')
    .single();
  if (insertError) return NextResponse.json({ error: 'Could not record the follow-up.' }, { status: 500 });
  return NextResponse.json({ ok: true, id: event.id });
}
