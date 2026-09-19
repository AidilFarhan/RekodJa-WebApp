'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';

const STAGES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'];

type SheetResult = { synced: boolean; message?: string } | null | undefined;

export default function StageChanger({ applicationId, stage: initialStage, clientId }: { applicationId: string; stage: string; clientId: string }) {
  const [stage, setStage] = useState(initialStage);
  const [busy, setBusy] = useState(false);
  const [sheetNote, setSheetNote] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();
  async function change(nextStage: string) {
    if (nextStage === stage) return;
    setBusy(true);
    setSheetNote(null);
    try {
      let googleToken = '';
      try { googleToken = await requestGoogleToken(clientId); } catch { googleToken = ''; }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (googleToken) headers.Authorization = `Bearer ${googleToken}`;
      const response = await fetch(`/api/applications/${applicationId}`, { method: 'PATCH', headers, body: JSON.stringify({ stage: nextStage }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update the stage.');
      setStage(result.stage ?? nextStage);
      router.refresh();
      const sheet: SheetResult = result.sheet;
      if (sheet?.synced) setSheetNote({ text: 'Synced to your Google Sheet ✓', ok: true });
      else if (sheet && !sheet.synced) setSheetNote({ text: `Saved here, but the Google Sheet was not updated: ${sheet.message ?? 'Google access was unavailable.'}`, ok: false });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not update the stage.');
    } finally { setBusy(false); }
  }
  return <div className="stage-changer">
    <select className={'stage-select status-' + stage.toLowerCase()} value={stage} disabled={busy} onChange={(event) => change(event.target.value)} aria-label="Application stage">{STAGES.map((option) => <option key={option} value={option}>{option}</option>)}</select>
    {sheetNote && <p className={'stage-sync-note ' + (sheetNote.ok ? 'ok' : 'warn')} role="status">{sheetNote.text}</p>}
  </div>;
}
