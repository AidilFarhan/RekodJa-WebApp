'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';
import { GMAIL_READONLY_SCOPE } from '@/lib/gmail/scan-engine';
import { ATTENTION_TABS, stages, type AttentionItem, type AttentionType } from '@/lib/dashboard';

export type ActionApplication = { id: string; company: string; role: string };

const TABS: { label: string; type: AttentionType | null }[] = [{ label: 'All', type: null }, ...ATTENTION_TABS];

/*
 * One recency key per item so a single Latest/Oldest control can order a list
 * that mixes email detections (dated) with follow-ups (measured in waiting
 * days). Bigger means more recent.
 */
function recency(item: AttentionItem) {
  if (item.internal_date_ms !== null) return item.internal_date_ms;
  return item.days === null ? 0 : -item.days;
}

function initialStage(status: string | null) {
  return status && (stages as string[]).includes(status) ? status : 'Applied';
}

async function googleHeaders(clientId: string) {
  let token = '';
  try { token = await requestGoogleToken(clientId, GMAIL_READONLY_SCOPE); } catch { token = ''; }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/*
 * Review form for candidate items that need a decision: unmatched emails and
 * anything in Needs Review. When an application is already bound, the
 * destination is preselected and the confirm button syncs the stage; when
 * not, the user creates or attaches an application first, then confirms.
 * Confirming or dismissing flips review_state away from 'pending', which
 * removes the item from the bucket on refresh.
 */
function ReviewCard({ item, applications, clientId }: {
  item: AttentionItem;
  applications: ActionApplication[];
  clientId: string;
}) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(item.company ?? '');
  const [role, setRole] = useState(item.role ?? '');
  const [stage, setStage] = useState(initialStage(item.stage));
  const [destination, setDestination] = useState(item.applicationId ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const router = useRouter();

  async function createApplication() {
    if (!company.trim() || !role.trim()) {
      setFeedback('Company and role are needed to create the application.');
      return;
    }
    setBusy(true);
    setFeedback('Creating application…');
    try {
      const response = await fetch('/api/gmail/scan/confirm', {
        method: 'POST',
        headers: await googleHeaders(clientId),
        body: JSON.stringify({ messageId: item.messageId, createOnly: true, company, role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not create the application.');
      setDestination(result.id);
      setFeedback('Application created. Confirm the stage to finish.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not create the application.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmStage() {
    if (!destination) {
      setFeedback('Create or choose an application first.');
      return;
    }
    setBusy(true);
    setFeedback('Saving…');
    try {
      const response = await fetch('/api/gmail/scan/confirm', {
        method: 'POST',
        headers: await googleHeaders(clientId),
        body: JSON.stringify({ messageId: item.messageId, applicationId: destination, stage }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not confirm this email.');
      setFeedback(`Confirmed as ${result.stage}.`);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not confirm this email.');
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setFeedback('');
    try {
      const response = await fetch('/api/gmail/scan/candidates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: item.messageId, reviewState: 'dismissed' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not dismiss this email.');
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not dismiss this email.');
      setBusy(false);
    }
  }

  return <article className="attention-row">
    <div className="attention-main">
      <div className="attention-company"><strong>{item.company ?? 'Unknown company'}</strong>{item.stage ? <span>{item.stage}</span> : null}</div>
      <p className="attention-role">{item.role ?? 'No role detected'}</p>
      <p>{item.title}</p>
      {open && <div className="scan-card" style={{ marginTop: 14 }}>
        <p className="muted">{item.sender}</p>
        {/* Text only: the body is content anyone can email. */}
        <p className="scan-snippet">{item.snippet}</p>
        <div className="scan-grid">
          <label>Company
            <input value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>
          <label>Role
            <input value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label>Status
            <select value={stage} onChange={(event) => setStage(event.target.value)}>{stages.map((option) => <option key={option}>{option}</option>)}</select>
          </label>
          <label>Application
            <select value={destination} onChange={(event) => setDestination(event.target.value)}>
              <option value="">Create a new application</option>
              {applications.map((application) => <option key={application.id} value={application.id}>{application.company} — {application.role || 'No role'}</option>)}
            </select>
          </label>
        </div>
        <div className="button-row">
          {destination
            ? <button className="button primary" disabled={busy} onClick={confirmStage}>{busy ? 'Saving…' : 'Confirm stage'}</button>
            : <button className="button primary" disabled={busy || !company.trim() || !role.trim()} onClick={createApplication}>{busy ? 'Saving…' : 'Create application'}</button>}
          <button className="button" disabled={busy} onClick={dismiss}>Dismiss</button>
        </div>
        {feedback && <p className={'scan-feedback ' + (feedback.startsWith('Confirmed') ? 'ok' : 'warn')} role="status">{feedback}</p>}
      </div>}
    </div>
    <button className="button button-small" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Close' : 'Review'}</button>
  </article>;
}

/* Matched: the application exists, so this row links instead of becoming a form. */
function MatchedRow({ item }: { item: AttentionItem }) {
  const base = item.applicationId ? `/dashboard/applications/${item.applicationId}` : null;
  // Carry the origin so the detail page can point its back link at this page.
  const href = base ? `${base}?from=actions` : null;
  const isFollowUp = item.type === 'follow-up';
  return <article className="attention-row">
    <div className="attention-main">
      <div className="attention-company">
        {href ? <Link href={href}>{item.company ?? 'Unknown company'}</Link> : <strong>{item.company ?? 'Unknown company'}</strong>}
        {isFollowUp && item.days !== null ? <span>Waiting {item.days} days</span> : item.stage ? <span>{item.stage}</span> : null}
      </div>
      <p className="attention-role">{item.role ?? 'No role'}</p>
      <p>{isFollowUp && item.days !== null ? `No response for ${item.days} days` : item.title}</p>
    </div>
    {isFollowUp && base
      ? <Link className="button button-small" href={`${base}/follow-up?from=actions`}>Follow up<span aria-hidden="true">↗</span></Link>
      : href ? <Link className="button button-small" href={href}>Open<span aria-hidden="true">↗</span></Link> : null}
  </article>;
}

export default function ActionsClient({ items, applications, clientId, resolved }: {
  items: AttentionItem[];
  applications: ActionApplication[];
  clientId: string;
  resolved: number;
}) {
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState('Latest');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  const countFor = (type: AttentionType | null) => (type === null ? items.length : items.filter((item) => item.type === type).length);
  const activeTab = TABS.find((tab) => tab.label === filter) ?? TABS[0];
  const visible = (activeTab.type === null ? items : items.filter((item) => item.type === activeTab.type))
    .slice()
    .sort((a, b) => (sort === 'Latest' ? recency(b) - recency(a) : recency(a) - recency(b)));

  async function scan() {
    setScanning(true);
    setMessage('');
    try {
      const token = await requestGoogleToken(clientId, GMAIL_READONLY_SCOPE);
      const response = await fetch('/api/gmail/scan', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The scan failed.');
      const autoPart = result.autoConfirmed ? `, ${result.autoConfirmed} auto-confirmed` : '';
      const skipPart = result.autoDismissed ? `, ${result.autoDismissed} duplicates skipped` : '';
      setMessage(`${result.email}: ${result.scanned} emails read, ${result.skipped} unrelated skipped, ${result.candidates.length} candidate(s) found${autoPart}${skipPart}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The scan failed.');
    } finally {
      setScanning(false);
    }
  }

  return <section className="actions-page">
    <div className="tabs-row">
      <h1>Action Center</h1>
      <button className="button primary" disabled={scanning} onClick={scan}>{scanning ? 'Scanning…' : 'Scan Gmail'}</button>
    </div>
    <div className="tabs-row">
      <div className="tabs" aria-label="Action categories">{TABS.map((tab) => <button key={tab.label} aria-pressed={filter === tab.label} onClick={() => setFilter(tab.label)}>{tab.label}<span>{countFor(tab.type)}</span></button>)}</div>
      <label className="sort-filter">Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option>Latest</option><option>Oldest</option></select></label>
    </div>
    {message && <p className="message" role="status">{message}</p>}
    {visible.length === 0
      ? <div className="caught-up"><span className="caught-check" aria-hidden="true">✓</span><div><h3>Nothing needs you here.</h3><p>Scan Gmail, or wait for a reply. Detected updates only change your tracker once you confirm them.</p></div></div>
      : <div className="attention-list">{visible.map((item) =>
        (item.messageId && (item.type === 'unmatched' || item.type === 'review' || item.applicationId === null))
          ? <ReviewCard key={`${item.type}:${item.messageId}`} item={item} applications={applications} clientId={clientId} />
          : <MatchedRow key={`${item.type}:${item.messageId ?? item.applicationId}`} item={item} />)}</div>}
    <p className="footnote">{resolved} follow-ups recorded. Detected updates never change your tracker without confirmation.</p>
    {scanning && <div className="importing-overlay" role="status" aria-live="polite"><div className="importing-dialog"><img className="cat-img" src="/cat-run.gif" alt="Running cat" /><p>Scanning your Gmail…</p><div className="importing-track" aria-hidden="true"><span/><span/><span/></div></div></div>}
  </section>;
}
