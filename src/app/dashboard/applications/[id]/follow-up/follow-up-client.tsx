'use client';

import Link from 'next/link';
import { useState } from 'react';

type ApplicationInfo = { id: string; company: string; role: string; stage: string; dateApplied: string | null };

function dateLabel(value: string | null) {
  if (!value) return 'an earlier date';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
}

function draftTemplate(application: ApplicationInfo, name: string) {
  return `Subject: Following up on my application — ${application.role}

Dear ${application.company} Recruitment Team,

I hope you are well. I am writing to follow up on my application for the ${application.role} position, submitted on ${dateLabel(application.dateApplied)}.

I remain interested in the opportunity to contribute to your team. I would appreciate any update you can share on the recruitment timeline, and I would be happy to provide further information if helpful.

Thank you for your time and consideration.

Kind regards,
${name}`;
}

export default function FollowUpClient({ application, days, done: initiallyDone, name, from }: { application: ApplicationInfo; days: number; done: boolean; name: string; from?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [done, setDone] = useState(initiallyDone);
  const [busy, setBusy] = useState(false);
  const due = !done;
  async function recordFollowUp() {
    setBusy(true);
    try {
      const response = await fetch(`/api/applications/${application.id}/follow-up`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record the follow-up.');
      setDone(true);
      setFeedback('Follow-up recorded. Application stage unchanged.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Could not record the follow-up.'); }
    finally { setBusy(false); }
  }
  async function copyDraft() {
    try { await navigator.clipboard.writeText(draft ?? ''); setFeedback('Draft copied.'); }
    catch { setFeedback('Clipboard unavailable. Select the draft text and copy it manually.'); }
  }
  return <section className="follow-up-page">
    <Link className="back-link" href={from === 'actions' ? '/dashboard/actions' : '/dashboard/applications/' + application.id}>{from === 'actions' ? '← Action Center' : `← ${application.company}`}</Link>
    <p className="eyebrow">A THOUGHTFUL NEXT STEP</p>
    <h1>Follow up</h1>
    <p className="page-subtitle">{application.company} · {application.role}</p>
    <div className="surface follow-summary"><div><h2>{done ? 'Follow-up recorded' : due ? 'Follow-up recommended' : 'Draft a follow-up'}</h2><p className="muted">Applied {dateLabel(application.dateApplied)}{due ? ` · Waiting ${days} days` : ''}</p><p>{done ? 'Your timeline has been updated. The application stage is unchanged.' : 'No recruiter response detected. A short, polite check-in may help.'}</p></div><span className={'status-chip status-' + application.stage.toLowerCase()}><span aria-hidden="true" className="status-dot"/>{application.stage}</span></div>
    {draft === null ? <div className="draft-start"><h2>Start with a simple, professional note.</h2><p className="muted">You can edit every word before copying it.</p><button className="button primary" onClick={() => setDraft(draftTemplate(application, name))}>Generate Draft</button><p className="footnote">Local template · no AI service or email access</p></div> :
      <div className="draft-section"><label className="field">Your follow-up draft<textarea rows={15} value={draft} onChange={(event) => setDraft(event.target.value)}/></label><div className="button-row"><button className="button primary" onClick={copyDraft}>Copy</button><button className="button" onClick={() => setFeedback('Nothing was opened or sent. Copy the draft and send it from your own email.')}>Open Gmail</button></div></div>}
    {due && <div className="follow-complete"><div><h3>Already followed up?</h3><p className="muted">Record it after you have contacted the employer. This does not send an email.</p></div><button className="button" disabled={busy} onClick={recordFollowUp}>{busy ? 'Recording…' : 'Mark as Followed Up'}</button></div>}
    <p className="feedback" role="status">{feedback}</p>
  </section>;
}
