import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import { attentionItems, type AttentionCandidate, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import ActionsClient from './actions-client';
import { gmailAccessAllowed, gmailAccessKind } from '@/lib/billing/server';

export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const hasPro = gmailAccessAllowed(await gmailAccessKind(client, user));
  const [{ data: applications, error: applicationsError }, { data: events, error: eventsError }, { data: candidates, error: candidatesError }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url'),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at'),
    // The scan review queue. Only pending rows: confirmed and dismissed items
    // have either become history or been hidden, so they are not actions.
    hasPro ? client.from('gmail_scan_candidates').select('message_id, subject, sender_from, snippet, suggested_company, suggested_role, suggested_status, matched_application_id, review_state, internal_date_ms').eq('user_id', user.id).eq('review_state', 'pending') : Promise.resolve({ data: [], error: null }),
  ]);
  if (applicationsError || eventsError || candidatesError) throw new Error('Could not load actions.');
  const appEvents = (events ?? []) as DashboardEvent[];
  const typedApplications = (applications ?? []) as DashboardApplication[];
  // Buckets are derived here, never stored, so the rules can change without a
  // migration or a Gmail re-scan. See attentionTypeForCandidate in dashboard.ts.
  const items = attentionItems(typedApplications, appEvents, new Date(), (candidates ?? []) as AttentionCandidate[]);
  const resolved = appEvents.filter((event) => event.event_type === 'follow_up_completed').length;
  return <ActionsClient
    hasPro={hasPro}
    items={items}
    applications={typedApplications.map((application) => ({ id: application.id, company: application.company, role: application.role }))}
    clientId={googlePickerConfiguration()?.clientId ?? ''}
    resolved={resolved}
  />;
}
