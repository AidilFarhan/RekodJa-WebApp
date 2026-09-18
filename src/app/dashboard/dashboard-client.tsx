'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { eventLabel, filterApplications, sourcesFor, stages, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';

function date(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(value));
}
export default function DashboardClient({ applications, events }: { applications: DashboardApplication[]; events: DashboardEvent[] }) {
  const [stage, setStage] = useState('All stages');
  const [source, setSource] = useState('All sources');
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => filterApplications(applications, stage, source).filter(app => (app.company + ' ' + app.role).toLowerCase().includes(search.trim().toLowerCase())), [applications, stage, source, search]);
  const latest = useMemo(() => {
    const result = new Map<string, DashboardEvent>();
    for (const event of events) {
      const previous = result.get(event.application_id);
      if (!previous || event.occurred_at > previous.occurred_at) result.set(event.application_id, event);
    }
    return result;
  }, [events]);
  const clear = () => { setSearch(''); setStage('All stages'); setSource('All sources'); };
  return <section className="applications-page">
    <h1>Applications</h1>
    <div className="application-filters">
      <label>Search applications<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or role…" type="search" /></label>
      <label>Status<select value={stage} onChange={e => setStage(e.target.value)}><option value="All stages">All statuses</option>{stages.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Source<select value={source} onChange={e => setSource(e.target.value)}><option>All sources</option>{sourcesFor(applications).map(item => <option key={item}>{item}</option>)}</select></label>
      <button className="clear-filters" onClick={clear}>Clear filters</button>
    </div>
    <p className="application-count" role="status">{filtered.length} of {applications.length} applications</p>
    {applications.length === 0 ? <div className="empty-state"><h2>No applications yet</h2><Link href="/tracker-setup">Connect spreadsheet</Link></div> : filtered.length === 0 ? <div className="empty-state"><h2>No matching applications</h2><button onClick={clear}>Clear filters</button></div> :
      <div className="application-table-scroll"><table className="application-table"><caption className="sr-only">Your applications</caption><thead><tr><th>Company / role</th><th>Status</th><th>Applied</th><th>Source</th><th>Last activity</th></tr></thead><tbody>{filtered.map(app => {
        const event = latest.get(app.id);
        return <tr key={app.id}><td><Link href={'/dashboard/applications/' + app.id}>{app.company}</Link><span className="role-text">{app.role}</span></td><td><span className={'status-chip status-' + app.stage.toLowerCase()}><span aria-hidden="true" className="status-dot"/>{app.stage}</span></td><td>{date(app.date_applied)}</td><td>{app.source || '—'}</td><td>{event ? <><span>{eventLabel(event) + (event.event_status === 'detected' ? ' detected' : ' confirmed')}</span><span className="activity-date">{date(event.occurred_at)}</span></> : <span className="role-text">No activity recorded</span>}</td></tr>;
      })}</tbody></table></div>}
  </section>;
}
