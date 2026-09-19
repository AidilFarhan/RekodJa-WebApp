import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { stages, type Stage } from '@/lib/dashboard';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  let body: { stage?: string } = {};
  try { body = await request.json(); } catch { /* keep defaults */ }
  const nextStage = stages.includes(body.stage as Stage) ? (body.stage as Stage) : null;
  if (!nextStage) return NextResponse.json({ error: 'A valid stage is required.' }, { status: 400 });
  const { data: application, error: applicationError } = await client.from('applications').select('id, stage').eq('id', id).maybeSingle();
  if (applicationError) return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  if (application.stage === nextStage) return NextResponse.json({ ok: true, stage: nextStage });
  const { error: updateError } = await client.from('applications').update({ stage: nextStage, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (updateError) return NextResponse.json({ error: 'Could not update the stage.' }, { status: 500 });
  await client.from('application_events').insert({ application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'stage_change', from_stage: application.stage, to_stage: nextStage, source: 'manual' });
  return NextResponse.json({ ok: true, stage: nextStage });
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
