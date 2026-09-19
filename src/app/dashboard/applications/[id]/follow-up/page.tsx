import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import { waitingDays, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import FollowUpClient from './follow-up-client';

export const dynamic = 'force-dynamic';

export default async function FollowUpPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: application, error: applicationError }, { data: events, error: eventsError }, { data: profile }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url').eq('id', id).maybeSingle(),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at').eq('application_id', id),
    client.from('profiles').select('display_name').eq('id', user.id).single(),
  ]);
  if (applicationError || eventsError || !application) notFound();
  const applicationTyped = application as DashboardApplication;
  const appEvents = (events ?? []) as DashboardEvent[];
  const done = appEvents.some((event) => event.event_type === 'follow_up_completed');
  return <FollowUpClient application={{ id: applicationTyped.id, company: applicationTyped.company, role: applicationTyped.role, stage: applicationTyped.stage, dateApplied: applicationTyped.date_applied }} days={waitingDays(applicationTyped.date_applied)} done={done} name={profile?.display_name || 'there'} from={from} clientId={googlePickerConfiguration()?.clientId ?? ''} />;
}
