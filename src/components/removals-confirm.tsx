'use client';

import { useState } from 'react';

export type Removal = { id: string; company: string; role: string };

export default function RemovalsConfirm({ connectionId, removals, onDone }: { connectionId: string; removals: Removal[]; onDone: (removed: number) => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/sheet-connections/${connectionId}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationIds: removals.map((removal) => removal.id) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove the applications.');
      onDone(result.removed ?? 0);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not remove the applications.');
      setBusy(false);
    }
  }
  return <div className="importing-overlay" role="dialog" aria-modal="true"><div className="importing-dialog sync-dialog">
    <p className="popup-title">These applications are no longer in your spreadsheet:</p>
    <ul className="sync-notes">{removals.map((removal) => <li key={removal.id}><strong>{removal.company}</strong>{removal.role ? ` · ${removal.role}` : ''}</li>)}</ul>
    <p className="muted">Delete them from your tracker too?</p>
    <div className="button-row"><button className="button danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete from tracker'}</button><button className="button" disabled={busy} onClick={() => onDone(0)}>Keep them</button></div>
  </div></div>;
}
