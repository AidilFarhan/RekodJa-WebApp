import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import { attentionItems, overviewMetrics, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import TodayDate from './today-date';
import RateMetric from './rate-metric';
import SyncTrackerButton from '../settings/sync-tracker-button';

export const dynamic = 'force-dynamic';

function date(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
}

export default async function OverviewPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: applications, error: applicationsError }, { data: events, error: eventsError }, { data: profile }, { data: connections }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url').order('date_applied', { ascending: false, nullsFirst: false }),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at').order('occurred_at', { ascending: false }),
    client.from('profiles').select('display_name').eq('id', user.id).single(),
    client.from('sheet_connections').select('id, spreadsheet_name, sheet_name').order('created_at'),
  ]);
  if (applicationsError || eventsError) throw new Error('Could not load your overview.');
  const pickerConfig = googlePickerConfiguration();
  const applicationsTyped = (applications ?? []) as DashboardApplication[];
  const appEvents = (events ?? []) as DashboardEvent[];
  const metrics = overviewMetrics(applicationsTyped, appEvents);
  const rejections = applicationsTyped.filter(application => application.stage === 'Rejected').length;
  const rejectionRate = applicationsTyped.length ? Math.round(rejections / applicationsTyped.length * 100) : 0;
  const attentionAll = attentionItems(applicationsTyped, appEvents);
  const attention = attentionAll.slice(0, 4);
  const name = profile?.display_name || 'there';
  const recent = applicationsTyped.slice(0, 5);
  return <section className="overview-page">
    <TodayDate />
    <div className="overview-heading"><h1>Hello, {name}.</h1>{connections && connections.length > 0 && pickerConfig && <SyncTrackerButton connectionId={connections[0].id} clientId={pickerConfig.clientId} />}</div>
    <section className="overview-attention">
      <div className="section-heading"><div><h2>Needs Attention <span className="count-pill">{attentionAll.length}</span></h2><p className="muted">What needs your attention in your job search?</p></div><Link className="quiet-link" href="/dashboard/actions">View all actions →</Link></div>
      {attention.length === 0 ? <div className="caught-up"><span className="caught-check" aria-hidden="true">✓</span><div><h3>You’re all caught up.</h3><p>No pending reviews or follow-ups. Your next steps will appear here.</p></div></div> :
        <div className="attention-list">{attention.map((action) => <article className="attention-row" key={action.type + ':' + (action.applicationId ?? 'none')}><div className="attention-main"><div className="attention-company">{action.applicationId ? <Link href={'/dashboard/applications/' + action.applicationId}>{action.company}</Link> : <strong>{action.company ?? 'Unmatched email'}</strong>}<span>{action.days !== null ? `Waiting ${action.days} days` : ''}</span></div><p className="attention-role">{action.role ?? 'Choose the right application'}</p><p>{action.title}</p></div>{action.type === 'follow-up' && action.applicationId ? <Link className="button button-small" href={'/dashboard/applications/' + action.applicationId + '/follow-up?from=actions'}>Follow up<span aria-hidden="true">↗</span></Link> : null}</article>)}</div>}
    </section>
    <div className="overview-metrics">
      <div className="section-heading"><h2>Your search at a glance</h2><Link className="quiet-link" href="/dashboard/analytics">View analytics →</Link></div>
      <div className="metrics">
        <div><span className="muted">Applications</span><strong>{metrics.applications}</strong></div>
        <RateMetric label="Rejection rate" rate={rejectionRate} count={rejections} />
        <RateMetric label="Interview rate" rate={metrics.interviewRate} count={metrics.interviews} />
        <RateMetric label="Offer rate" rate={metrics.offerRate} count={metrics.offers} />
      </div>
    </div>
    <div>
      <div className="section-heading"><h2>Recent Applications</h2><Link className="quiet-link" href="/dashboard">View all {applicationsTyped.length} →</Link></div>
      {recent.length === 0 ? <div className="empty-state"><h2>No applications yet</h2><p>Connect your spreadsheet to get started.</p><Link href="/tracker-setup">Connect spreadsheet</Link></div> :
        <div className="application-table-scroll"><table className="application-table"><caption className="sr-only">Recent applications</caption><thead><tr><th>Company / role</th><th>Status</th><th>Applied</th><th>Source</th></tr></thead><tbody>{recent.map((application) => <tr key={application.id}><td><Link href={'/dashboard/applications/' + application.id}>{application.company}</Link><span className="role-text">{application.role}</span></td><td><span className={'status-chip status-' + application.stage.toLowerCase()}><span aria-hidden="true" className="status-dot"/>{application.stage}</span></td><td>{date(application.date_applied)}</td><td>{application.source || '—'}</td></tr>)}</tbody></table></div>}
    </div>
  </section>;
}
