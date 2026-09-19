'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';
import { GMAIL_READONLY_SCOPE } from '@/lib/gmail/scan-engine';

type ApplicationOption = { id: string; company: string; role: string; job_url: string };

type Candidate = {
  id: string;
  message_id: string;
  thread_id: string;
  email: string;
  internal_date_ms: number;
  subject: string;
  sender_from: string;
  sender_email: string;
  snippet: string;
  suggested_company: string;
  suggested_role: string;
  suggested_status: string;
  event_type: string;
  matched_application_id: string | null;
  review_state: 'pending' | 'confirmed' | 'dismissed';
  confirmed_stage: string | null;
  created_at: string;
};

const STAGES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'];

function ScanCard({ candidate, applications, clientId, onSaved }: {
  candidate: Candidate;
  applications: ApplicationOption[];
  clientId: string;
  onSaved: () => void;
}) {
  const [company, setCompany] = useState(candidate.suggested_company);
  const [role, setRole] = useState(candidate.suggested_role);
  const [stage, setStage] = useState(STAGES.includes(candidate.suggested_status) ? candidate.suggested_status : 'Applied');
  const [destination, setDestination] = useState(candidate.matched_application_id ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const matched = applications.find((application) => application.id === candidate.matched_application_id);

  async function confirmCard() {
    setBusy(true);
    setFeedback('Saving…');
    try {
      let googleToken = '';
      try { googleToken = await requestGoogleToken(clientId); } catch { googleToken = ''; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) headers.Authorization = `Bearer ${googleToken}`;
      const response = await fetch('/api/gmail/scan/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messageId: candidate.message_id,
          applicationId: destination || null,
          company,
          role,
          stage,
          threadLink: `https://mail.google.com/mail/?authuser=${encodeURIComponent(candidate.email)}#all/${candidate.thread_id}`,
          dateApplied: new Date(candidate.internal_date_ms).toISOString().slice(0, 10),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not confirm this email.');
      const sheetNote = result.sheet?.synced ? ' Google Sheet updated ✓' : result.sheet ? ` Google Sheet not updated: ${result.sheet.message ?? ''}` : '';
      setFeedback(`Confirmed as ${result.stage}.${sheetNote}`);
      onSaved();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not confirm this email.');
    } finally { setBusy(false); }
  }

  if (candidate.review_state === 'confirmed') {
    return <div className="scan-card scan-done">
      <h3>{candidate.subject || '(No subject)'}</h3>
      <p className="muted">{candidate.sender_from}</p>
      <p className="scan-confirmed">✓ Confirmed as {candidate.confirmed_stage ?? '—'} · {matched ? matched.company : candidate.suggested_company}</p>
    </div>;
  }

  return <div className="scan-card">
    <h3>{candidate.subject || '(No subject)'}</h3>
    <p className="muted">{candidate.sender_from}{matched ? ` · matches ${matched.company} — ${matched.role || 'No role'}` : ' · no existing match'}</p>
    <p className="scan-snippet">{candidate.snippet}</p>
    <div className="scan-grid">
      <label>Company
        <input value={company} onChange={(event) => setCompany(event.target.value)} />
      </label>
      <label>Role
        <input value={role} onChange={(event) => setRole(event.target.value)} />
      </label>
      <label>Status
        <select value={stage} onChange={(event) => setStage(event.target.value)}>{STAGES.map((option) => <option key={option}>{option}</option>)}</select>
      </label>
      <label>Application
        <select value={destination} onChange={(event) => setDestination(event.target.value)}>
          <option value="">Create new application…</option>
          {applications.map((application) => <option key={application.id} value={application.id}>{application.company} — {application.role || 'No role'}</option>)}
        </select>
      </label>
    </div>
    <button className="button primary" disabled={busy || !company.trim() || !role.trim()} onClick={confirmCard}>{busy ? 'Saving…' : 'Confirm'}</button>
    {feedback && <p className={'scan-feedback ' + (feedback.includes('✓') ? 'ok' : feedback.startsWith('Confirmed') ? 'ok' : 'warn')} role="status">{feedback}</p>}
  </div>;
}

export default function GmailScanClient({ clientId, applications }: { clientId: string; applications: ApplicationOption[] }) {
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  const loadSaved = useCallback(async () => {
    try {
      const response = await fetch('/api/gmail/scan/candidates');
      const result = await response.json();
      if (response.ok && Array.isArray(result.candidates)) setCandidates(result.candidates);
    } catch { /* leave empty */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  async function scan() {
    setBusy(true);
    setScanning(true);
    setMessage('');
    try {
      const token = await requestGoogleToken(clientId, GMAIL_READONLY_SCOPE);
      const response = await fetch('/api/gmail/scan', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The scan failed.');
      setMessage(`${result.email}: ${result.scanned} emails read, ${result.skipped} unrelated skipped, ${result.candidates.length} candidate(s) found.`);
      setCandidates(result.candidates);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The scan failed.');
    } finally {
      setBusy(false);
      setScanning(false);
    }
  }

  const pending = candidates.filter((candidate) => candidate.review_state === 'pending').length;

  return <div>
    <div className="scan-actions">
      <button className="button primary" disabled={busy} onClick={scan}>{busy ? 'Working…' : 'Scan Gmail (last 3 months)'}</button>
      {loaded && <p className="muted">{candidates.length ? `${pending} pending · ${candidates.length - pending} confirmed` : 'No saved scan results yet.'}</p>}
    </div>
    {message && <p className="message" role="status">{message}</p>}
    <div className="scan-list">
      {candidates.map((candidate) => <ScanCard key={candidate.message_id} candidate={candidate} applications={applications} clientId={clientId} onSaved={() => setCandidates((previous) => previous.map((item) => item.message_id === candidate.message_id ? { ...item, review_state: 'confirmed', confirmed_stage: STAGES[0] } : item))} />)}
    </div>
    {scanning && <div className="importing-overlay" role="status" aria-live="polite"><div className="importing-dialog"><img className="cat-img" src="/cat-run.gif" alt="Running cat" /><p>Scanning your Gmail…</p><div className="importing-track" aria-hidden="true"><span/><span/><span/></div></div></div>}
  </div>;
}
