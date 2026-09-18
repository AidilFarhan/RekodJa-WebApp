import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import DashboardClient from './dashboard-client';
import type { DashboardApplication, DashboardEvent } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: applications, error: applicationsError }, { data: events, error: eventsError }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url').order('date_applied', { ascending: false, nullsFirst: false }),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at').order('occurred_at', { ascending: false }),
  ]);
  if (applicationsError || eventsError) throw new Error('Could not load applications.');
  return <DashboardClient applications={(applications ?? []) as DashboardApplication[]} events={(events ?? []) as DashboardEvent[]} />;
}
