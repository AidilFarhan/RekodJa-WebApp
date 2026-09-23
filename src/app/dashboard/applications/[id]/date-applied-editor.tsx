'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';

type SheetResult = { synced: boolean; message?: string } | null | undefined;

export default function DateAppliedEditor({ applicationId, dateApplied, clientId }: { applicationId: string; dateApplied: string | null; clientId: string }) {
  const [value, setValue] = useState(dateApplied ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();

  async function save() {
    if (!value) {
      setNote({ text: 'Please choose a date.', ok: false });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      let googleToken = '';
      try { googleToken = await requestGoogleToken(clientId); } catch { googleToken = ''; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) headers.Authorization = `Bearer ${googleToken}`;
      const response = await fetch(`/api/applications/${applicationId}`, {
        method: 'PATCH', headers, body: JSON.stringify({ dateApplied: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update the date applied.');
      router.refresh();
      const sheet: SheetResult = result.sheet;
      if (sheet?.synced) setNote({ text: 'Date updated in your Google Sheet ✓', ok: true });
      else if (sheet && !sheet.synced) setNote({ text: `Saved here, but the Google Sheet was not updated: ${sheet.message ?? 'Google access was unavailable.'}`, ok: false });
      else setNote({ text: 'Date applied saved.', ok: true });
    } catch (error) {
      setNote({ text: error instanceof Error ? error.message : 'Could not update the date applied.', ok: false });
    } finally {
      setBusy(false);
    }
  }

  return <div className="date-applied-editor">
    <input type="date" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} aria-label="Date applied" />
    <button type="button" className="button button-small" disabled={busy || value === (dateApplied ?? '')} onClick={save}>{busy ? 'Saving…' : 'Save date'}</button>
    {note && <p className={'date-sync-note ' + (note.ok ? 'ok' : 'warn')} role="status">{note.text}</p>}
  </div>;
}
