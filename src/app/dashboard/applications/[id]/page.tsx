import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import { eventLabel, eventsForApplication, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import DeleteApplicationButton from './delete-application-button';
import StageChanger from './stage-changer';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export default async function ApplicationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: application, error: applicationError }, { data: events, error: eventsError }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url').eq('id', id).maybeSingle(),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at').eq('application_id', id).order('occurred_at', { ascending: false }),
  ]);
  if (applicationError || eventsError || !application) notFound();
  const typedApplication = application as DashboardApplication;
  const timeline = eventsForApplication((events ?? []).filter((event) => event.event_status === 'user_confirmed') as DashboardEvent[], id);
  return <section><Link href="/dashboard">← Back to applications</Link><div className="detail-heading"><div><p className="eyebrow">Application</p><h1>{typedApplication.company}</h1><p>{typedApplication.role}</p></div><StageChanger applicationId={typedApplication.id} stage={typedApplication.stage} clientId={googlePickerConfiguration()?.clientId ?? ''} /></div><dl className="detail-grid"><div><dt>Date applied</dt><dd>{formatDate(typedApplication.date_applied)}</dd></div><div><dt>Source</dt><dd>{typedApplication.source || '—'}</dd></div><div><dt>Job URL</dt><dd>{typedApplication.job_url ? <a href={typedApplication.job_url} target="_blank" rel="noreferrer">Open listing</a> : '—'}</dd></div></dl><div className="timeline"><h2>Confirmed history</h2>{timeline.length === 0 ? <p className="empty-state">No confirmed events recorded yet.</p> : <ol>{timeline.map((event) => <li key={event.id}><div className="timeline-dot"/><div><strong>{eventLabel(event)}</strong><p>{event.event_status === 'user_confirmed' ? 'User confirmed' : 'Detected observation'} · {formatDate(event.occurred_at)}</p></div></li>)}</ol>}</div><div className="detail-delete"><DeleteApplicationButton applicationId={typedApplication.id} company={typedApplication.company} /></div></section>;
}
