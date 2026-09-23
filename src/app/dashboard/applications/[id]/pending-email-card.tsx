'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';
import { GMAIL_READONLY_SCOPE } from '@/lib/gmail/scan-engine';
import { stages } from '@/lib/dashboard';

export type PendingEmail = {
  message_id: string;
  subject: string;
  sender_from: string;
  snippet: string;
  suggested_status: string;
  internal_date_ms: number;
};

// Gmail internalDate is an epoch in ms. Format in the browser's local time so
// the date matches what the user sees in the Gmail header.
function receivedDate(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/*
 * One pending detection. Company, role and the application are already known
 * because the user is standing on that application, so the only choice left is
 * the stage — no combobox, no picker. Confirming writes the event and the stage
 * and syncs the connected Sheet; nothing is applied before that.
 */
function EmailRow({ email, applicationId, clientId, onResolved }: {
  email: PendingEmail;
  applicationId: string;
  clientId: string;
  onResolved: (messageId: string) => void;
}) {
  const [stage, setStage] = useState(stages.includes(email.suggested_status as (typeof stages)[number]) ? email.suggested_status : 'Applied');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const router = useRouter();

  async function confirm() {
    setBusy(true);
    setFeedback('Saving…');
    try {
      let token = '';
      try { token = await requestGoogleToken(clientId, GMAIL_READONLY_SCOPE); } catch { token = ''; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch('/api/gmail/scan/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId: email.message_id, applicationId, stage }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not confirm this email.');
      const sheetNote = result.sheet?.synced ? ' Sheet updated.' : '';
      setFeedback(`Confirmed as ${result.stage}.${sheetNote}`);
      onResolved(email.message_id);
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
        body: JSON.stringify({ messageId: email.message_id, reviewState: 'dismissed' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not dismiss this email.');
      onResolved(email.message_id);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not dismiss this email.');
      setBusy(false);
    }
  }

  return <div className="scan-card">
    <h3>{email.subject || '(No subject)'}</h3>
    <p className="muted">{email.sender_from}</p>
    {/* Rendered as text, never as HTML: the body is content anyone can email. */}
    <p className="scan-snippet">{email.snippet}</p>
    <div className="scan-grid">
      <label>Status
        <select value={stage} onChange={(event) => setStage(event.target.value)}>{stages.map((option) => <option key={option}>{option}</option>)}</select>
      </label>
      <label>Received
        <input readOnly value={receivedDate(email.internal_date_ms)} />
      </label>
    </div>
    <div className="button-row">
      <button className="button primary" disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Confirm stage'}</button>
      <button className="button" disabled={busy} onClick={dismiss}>Dismiss</button>
    </div>
    {feedback && <p className={'scan-feedback ' + (feedback.startsWith('Confirmed') ? 'ok' : 'warn')} role="status">{feedback}</p>}
  </div>;
}

/*
 * Pending detections for one application, shown directly above Confirmed
 * history so the transition reads as pending -> confirmed.
 *
 * Only the most recent is shown by default. Older ones stay reachable behind
 * the toggle rather than being hidden outright, because a hidden pending row
 * can never be confirmed or dismissed and would sit in the queue forever.
 */
export default function PendingEmailCard({ emails, applicationId, clientId }: {
  emails: PendingEmail[];
  applicationId: string;
  clientId: string;
}) {
  const [items, setItems] = useState(emails);
  const [showOlder, setShowOlder] = useState(false);

  if (items.length === 0) return null;
  const [latest, ...older] = items;
  const remove = (messageId: string) => setItems((previous) => previous.filter((item) => item.message_id !== messageId));

  return <div className="timeline">
    <h2>Awaiting your review</h2>
    <EmailRow email={latest} applicationId={applicationId} clientId={clientId} onResolved={remove} />
    {older.length > 0 && <div className="button-row" style={{ marginTop: 10 }}>
      <button className="button button-small" onClick={() => setShowOlder((value) => !value)}>
        {showOlder ? 'Hide older' : `${older.length} older pending`}
      </button>
    </div>}
    {showOlder && older.map((email) => <div key={email.message_id} style={{ marginTop: 14 }}>
      <EmailRow email={email} applicationId={applicationId} clientId={clientId} onResolved={remove} />
    </div>)}
  </div>;
}
