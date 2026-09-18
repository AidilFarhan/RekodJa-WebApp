'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

type GoogleAccountsWindow = {
  google: {
    accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void } } };
  };
};

const googleWindow = () => (window as unknown as GoogleAccountsWindow);

function loadScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') return resolve();
    const script = existing ?? document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error('Google library could not load.'));
    if (!existing) document.head.appendChild(script);
  });
}

function authorize(clientId: string, token: string) {
  return new Promise<string>((resolve, reject) => {
    loadScript('google-identity-services', 'https://accounts.google.com/gsi/client')
      .then(() => {
        const client = googleWindow().google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_FILE_SCOPE,
          callback: (response) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Authorization was cancelled.')),
        });
        client.requestAccessToken({ prompt: token ? '' : 'consent' });
      })
      .catch(reject);
  });
}

function summary(result: { created?: number; updated?: number; skipped?: number; skippedDetails?: string[] }) {
  const created = result.created ?? 0;
  const updated = result.updated ?? 0;
  const skipped = result.skipped ?? 0;
  const counts = [`${created} new`, `${updated} updated`, skipped ? `${skipped} skipped` : ''].filter(Boolean).join(', ');
  const notes = (result.skippedDetails ?? []).slice(0, 3).join(' ');
  return notes ? `Synced — ${counts}. ${notes}` : `Synced — ${counts}.`;
}

export default function SyncTrackerButton({ connectionId, clientId }: { connectionId: string; clientId: string }) {
  const token = useRef('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  async function sync() {
    setBusy(true);
    setMessage('');
    try {
      token.current = await authorize(clientId, token.current);
      const response = await fetch(`/api/sheet-connections/${connectionId}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sync failed.');
      setMessage(summary(result));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sync failed.');
    } finally { setBusy(false); }
  }
  return <div className="sync-row"><button className="button" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync now'}</button>{message && <span className="sync-feedback" role="status">{message}</span>}</div>;
}
