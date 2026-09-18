import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { followUpActions, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import ActionsClient from './actions-client';

export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: applications, error: applicationsError }, { data: events, error: eventsError }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url'),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at'),
  ]);
  if (applicationsError || eventsError) throw new Error('Could not load actions.');
  const appEvents = (events ?? []) as DashboardEvent[];
  const actions = followUpActions((applications ?? []) as DashboardApplication[], appEvents);
  const resolved = appEvents.filter((event) => event.event_type === 'follow_up_completed').length;
  return <ActionsClient actions={actions} resolved={resolved} />;
}
