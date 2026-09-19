'use client';

import Link from 'next/link';
import { useState } from 'react';
import { requestGoogleToken } from '@/lib/google-token';

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

export default function FollowUpClient({ application, days, done: initiallyDone, name, from, clientId }: { application: ApplicationInfo; days: number; done: boolean; name: string; from?: string; clientId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [done, setDone] = useState(initiallyDone);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(application.stage);
  const [outcome, setOutcome] = useState('');
  const due = !done;
  const OUTCOMES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn', 'Replied'];
  async function recordFollowUp() {
    if (!outcome) return setFeedback('Choose what happened next before recording.');
    setBusy(true);
    try {
      const replied = outcome === 'Replied';
      let googleToken = '';
      try { googleToken = await requestGoogleToken(clientId); } catch { googleToken = ''; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) headers.Authorization = `Bearer ${googleToken}`;
      const response = await fetch(`/api/applications/${application.id}/follow-up`, { method: 'POST', headers, body: JSON.stringify(replied ? { replied: true } : { stage: outcome }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not record the follow-up.');
      setDone(true);
      if (result.stage) setStage(result.stage);
      const sheetNote = result.sheet?.synced ? ' The status was also updated in your Google Sheet.' : result.sheet ? ` The Google Sheet was not updated: ${result.sheet.message ?? ''}` : '';
      setFeedback(replied ? `Follow-up recorded. Employer reply noted.${sheetNote}` : result.stage ? `Follow-up recorded. Stage updated to ${result.stage}.${sheetNote}` : `Follow-up recorded. Stage unchanged.${sheetNote}`);
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
    <div className="surface follow-summary"><div><h2>{done ? 'Follow-up recorded' : due ? 'Follow-up recommended' : 'Draft a follow-up'}</h2><p className="muted">Applied {dateLabel(application.dateApplied)}{due ? ` · Waiting ${days} days` : ''}</p><p>{done ? 'Your timeline has been updated.' : 'No recruiter response detected. A short, polite check-in may help.'}</p></div><span className={'status-chip status-' + stage.toLowerCase()}><span aria-hidden="true" className="status-dot"/>{stage}</span></div>
    {draft === null ? <div className="draft-start"><h2>Start with a simple, professional note.</h2><p className="muted">You can edit every word before copying it.</p><button className="button primary" onClick={() => setDraft(draftTemplate(application, name))}>Generate Draft</button><p className="footnote">Local template · no AI service or email access</p></div> :
      <div className="draft-section"><label className="field">Your follow-up draft<textarea rows={15} value={draft} onChange={(event) => setDraft(event.target.value)}/></label><div className="button-row"><button className="button primary" onClick={copyDraft}>Copy</button><button className="button" onClick={() => setFeedback('Nothing was opened or sent. Copy the draft and send it from your own email.')}>Open Gmail</button></div></div>}
    {due && <div className="follow-complete"><div><h3>Already followed up?</h3><p className="muted">Record it after you have contacted the employer. This does not send an email.</p></div><div className="stage-record"><select value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Outcome"><option value="">Choose what happened…</option>{OUTCOMES.map((option) => <option key={option} value={option}>{option}{option === application.stage ? ' (current)' : ''}</option>)}</select><button className="button" disabled={busy || !outcome} onClick={recordFollowUp}>{busy ? 'Recording…' : 'Record'}</button></div></div>}
    <p className="feedback" role="status">{feedback}</p>
  </section>;
}
