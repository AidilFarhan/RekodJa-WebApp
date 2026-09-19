import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { bucketLabel, overviewMetrics, pipelineCounts, sourcePerformance, weeklyBuckets, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

function fullDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
}

function SourceMark({ source }: { source: string }) {
  if (source === 'LinkedIn') return <svg className="source-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#0A66C2"/><text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">in</text></svg>;
  if (source === 'JobStreet') return <svg className="source-mark" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#E6007E"/><circle cx="8" cy="5.4" r="3.3" fill="#0D3880"/><circle cx="6.5" cy="5.5" r="1.15" fill="#fff"/><circle cx="7.5" cy="4.9" r="0.85" fill="#fff"/><circle cx="8.5" cy="4.3" r="0.6" fill="#fff"/><circle cx="9.5" cy="3.7" r="0.4" fill="#fff"/><text x="8" y="13.4" textAnchor="middle" fontSize="4.6" fontWeight="700" fill="#fff" fontFamily="Arial, Helvetica, sans-serif">jobs</text></svg>;
  if (source === 'Company Website') return <svg className="source-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5c6678" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.7 2.5 4.1 5.5 4.1 9S14.7 18.5 12 21c-2.7-2.5-4.1-5.5-4.1-9S9.3 5.5 12 3z"/></svg>;
  return null;
}

export default async function AnalyticsPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: applications, error: applicationsError }, { data: events, error: eventsError }] = await Promise.all([
    client.from('applications').select('id, company, role, stage, date_applied, source, job_url').order('date_applied', { ascending: false, nullsFirst: false }),
    client.from('application_events').select('id, application_id, event_status, event_type, from_stage, to_stage, source, occurred_at').order('occurred_at', { ascending: false }),
  ]);
  if (applicationsError || eventsError) throw new Error('Could not load analytics.');
  const apps = (applications ?? []) as DashboardApplication[];
  const appEvents = (events ?? []) as DashboardEvent[];
  const metrics = overviewMetrics(apps, appEvents);
  const buckets = weeklyBuckets(apps);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const pipeline = pipelineCounts(apps);
  const sources = sourcePerformance(apps, appEvents);
  const rangeLabel = buckets.length ? `${fullDate(buckets[0].start)} – ${fullDate(buckets[buckets.length - 1].end)}` : '';
  return <section className="analytics-page">
    <h1>Analytics</h1>
    <div className="metrics">
      <div><span className="muted">Applications</span><strong>{metrics.applications}</strong></div>
      <div><span className="muted">Response rate</span><strong>{metrics.responseRate}%</strong></div>
      <div><span className="muted">Interview rate</span><strong>{metrics.interviewRate}%</strong></div>
      <div><span className="muted">Offer rate</span><strong>{metrics.offerRate}%</strong></div>
    </div>
    <div className="analytics-grid">
      <section className="surface"><h2>Applications over time</h2><p className="muted">{rangeLabel}</p><div className="column-chart" role="img" aria-label={buckets.map((bucket) => `${bucketLabel(bucket.start, bucket.end)}: ${bucket.count} applications`).join('; ')}>{buckets.map((bucket) => <div className="chart-column" key={bucket.start}><span>{bucket.count}</span><div className="bar-track"><div style={{ height: `${(bucket.count / max) * 100}%` }}/></div><small>{bucketLabel(bucket.start, bucket.end)}</small></div>)}</div></section>
      <section className="surface"><h2>Current pipeline</h2><p className="muted">Where applications stand today</p><div className="pipeline">{pipeline.map(({ stage, count }) => <div key={stage}><span>{stage}</span><div className="horizontal-track"><div style={{ width: `${apps.length ? (count / apps.length) * 100 : 0}%` }}/></div><strong>{count}</strong></div>)}</div></section>
    </div>
    <div>
      <div className="section-heading"><h2>Source performance</h2><span className="muted">Confirmed history</span></div>
      <div className="application-table-scroll"><table className="analytics-table"><thead><tr><th>Source</th><th>Applications</th><th>Responses</th><th>Interviews</th><th>Offers</th></tr></thead><tbody>{sources.map((row) => <tr key={row.source}><td className="source-cell"><SourceMark source={row.source}/><strong>{row.source}</strong></td><td>{row.applications}</td><td>{row.responses} <span className="muted">({row.responseRate}%)</span></td><td>{row.interviews} <span className="muted">({row.interviewRate}%)</span></td><td>{row.offers} <span className="muted">({row.offerRate}%)</span></td></tr>)}</tbody></table></div>
    </div>
    <details className="metric-definitions"><summary>How these metrics work</summary><p>Applications counts all unique tracked applications. All three rates use the same eligible submitted applications: applications withdrawn before any employer response are excluded; Ghosted applications remain included.</p><p>A meaningful response is a confirmed recruiter interaction, interview, offer or rejection. Automatic acknowledgements and unconfirmed detections do not count. Interview and offer rates use confirmed history, so a later rejection does not erase an earlier interview. An offer only counts as an interview if that progression appears in its history.</p></details>
  </section>;
}
