import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { stages, type Stage } from '@/lib/dashboard';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { id } = await params;
  const { data: application, error: applicationError } = await client.from('applications').select('id, stage').eq('id', id).maybeSingle();
  if (applicationError) return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 });
  if (!application) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  let body: { stage?: string; replied?: boolean } = {};
  try { body = await request.json(); } catch { /* keep defaults */ }
  const nextStage = stages.includes(body.stage as Stage) ? (body.stage as Stage) : null;
  const replied = body.replied === true;
  const stageChanged = nextStage !== null && nextStage !== application.stage;
  const events: { application_id: string; user_id: string; event_status: string; event_type: string; source: string; from_stage: string | null; to_stage: string | null }[] = [
    { application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'follow_up_completed', source: 'manual', from_stage: null, to_stage: null },
  ];
  if (stageChanged && nextStage) events.push({ application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'stage_change', source: 'manual', from_stage: application.stage, to_stage: nextStage });
  if (replied) events.push({ application_id: id, user_id: user.id, event_status: 'user_confirmed', event_type: 'employer_response', source: 'manual', from_stage: application.stage, to_stage: nextStage ?? application.stage });
  const { error: insertError } = await client.from('application_events').insert(events);
  if (insertError) return NextResponse.json({ error: 'Could not record the follow-up.' }, { status: 500 });
  if (stageChanged && nextStage) {
    const { error: updateError } = await client.from('applications').update({ stage: nextStage }).eq('id', id);
    if (updateError) return NextResponse.json({ error: 'Could not update the stage.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, stage: stageChanged ? nextStage : null, replied });
}
