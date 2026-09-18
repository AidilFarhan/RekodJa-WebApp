'use client';

import Link from 'next/link';
import { useState } from 'react';

type FollowUp = { applicationId: string; company: string; role: string; days: number };

const categories = ['All', 'Needs Review', 'Follow-ups', 'Recruiter Actions', 'Unmatched Emails'];

export default function ActionsClient({ actions, resolved }: { actions: FollowUp[]; resolved: number }) {
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState('Latest');
  const visible = actions
    .filter((action) => filter === 'All' || filter === 'Follow-ups')
    .sort((a, b) => (sort === 'Latest' ? a.days - b.days : b.days - a.days));
  const count = (name: string) => actions.filter((action) => name === 'All' || (name === 'Follow-ups')).length;
  return <section className="actions-page">
    <h1>Action Center</h1>
    <div className="tabs-row">
      <div className="tabs" aria-label="Action categories">{categories.map((name) => <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}<span>{count(name)}</span></button>)}</div>
      <label className="sort-filter">Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option>Latest</option><option>Oldest</option></select></label>
    </div>
    {visible.length === 0 ? <div className="caught-up"><span className="caught-check" aria-hidden="true">✓</span><div><h3>You’re all caught up.</h3><p>No pending reviews or follow-ups. Your next steps will appear here.</p></div></div> :
      <div className="attention-list">{visible.map((action) => <article className="attention-row" key={action.applicationId}><div className="attention-main"><div className="attention-company"><Link href={'/dashboard/applications/' + action.applicationId}>{action.company}</Link><span>Waiting {action.days} days</span></div><p className="attention-role">{action.role}</p><p>No response for {action.days} days</p></div><Link className="button button-small" href={'/dashboard/applications/' + action.applicationId + '/follow-up?from=actions'}>Follow up<span aria-hidden="true">↗</span></Link></article>)}</div>}
    <p className="footnote">{resolved} follow-ups recorded. Detected updates never change your tracker without confirmation.</p>
  </section>;
}
