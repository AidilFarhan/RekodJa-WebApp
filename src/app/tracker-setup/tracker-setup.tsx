'use client';

import { useEffect, useRef, useState } from 'react';
import RemovalsConfirm, { type Removal } from '@/components/removals-confirm';

type Connection = { id: string; spreadsheet_name: string; sheet_name: string };
type Config = { clientId: string; apiKey: string; appId: string };
type PickerDocument = { id: string; name: string };
type PickerResult = { action: string; docs?: PickerDocument[] };
type GoogleDocsView = { setMimeTypes(types: string): GoogleDocsView; setMode(mode: string): GoogleDocsView };
type GooglePickerBuilder = {
  addView(view: GoogleDocsView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(id: string): GooglePickerBuilder;
  setOrigin(origin: string): GooglePickerBuilder;
  setCallback(callback: (data: PickerResult) => void): GooglePickerBuilder;
  build(): { setVisible(value: boolean): void };
};

declare global {
  interface Window {
    google: {
      accounts: { oauth2: { initTokenClient(config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }): { requestAccessToken(options?: { prompt?: string }): void } } };
      picker: {
        Action: { PICKED: string };
        DocsView: new (viewId: string) => GoogleDocsView;
        PickerBuilder: new () => GooglePickerBuilder;
        ViewId: { SPREADSHEETS: string };
        DocsViewMode: { LIST: string };
      };
    };
    gapi: { load(name: string, callback: () => void): void };
  }
}

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

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

type ImportResult = { created?: number; updated?: number; stageChanged?: number; skipped?: number; skippedDetails?: string[]; warnings?: string[] };

function importSummary(result: ImportResult) {
  const created = result.created ?? 0;
  const updated = result.updated ?? 0;
  const skipped = result.skipped ?? 0;
  const counts = [`${created} new`, `${updated} updated`, skipped ? `${skipped} skipped` : ''].filter(Boolean).join(', ');
  const headline = counts ? `Import complete — ${counts}.` : 'Import complete.';
  const notes = [...(result.skippedDetails ?? []), ...(result.warnings ?? [])].slice(0, 6).join(' ');
  return notes ? `${headline} ${notes}` : headline;
}

export default function TrackerSetup({ config, connections }: { config: Config; connections: Connection[] }) {
  const token = useRef('');
  const pickerProbe = useRef<number | null>(null);
  const clearPickerProbe = () => {
    if (pickerProbe.current !== null) { window.clearInterval(pickerProbe.current); pickerProbe.current = null; }
  };
  useEffect(() => clearPickerProbe, []);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string; tabs: string[] } | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [removals, setRemovals] = useState<{ connectionId: string; items: Removal[] } | null>(null);

  async function authorize(): Promise<string> {
    await loadScript('google-identity-services', 'https://accounts.google.com/gsi/client');
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: (response) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Authorization was cancelled.')),
      });
      client.requestAccessToken({ prompt: token.current ? '' : 'consent' });
    });
  }

  async function openPicker() {
    setBusy(true); setMessage('');
    try {
      token.current = await authorize();
      await loadScript('google-api-loader', 'https://apis.google.com/js/api.js');
      await new Promise<void>((resolve) => window.gapi.load('picker', resolve));
      const view = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS);
      view.setMimeTypes('application/vnd.google-apps.spreadsheet');
      view.setMode(window.google.picker.DocsViewMode.LIST);
      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token.current)
        .setDeveloperKey(config.apiKey)
        .setAppId(config.appId)
        .setOrigin(window.location.origin)
        .setCallback(async (data) => {
          clearPickerProbe();
          if (data.action !== window.google.picker.Action.PICKED || !data.docs?.[0]) return;
          const doc = data.docs[0];
          setBusy(true);
          try {
            const response = await fetch('/api/google/sheets/tabs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` }, body: JSON.stringify({ spreadsheetId: doc.id }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not read spreadsheet tabs.');
            setPicked({ id: doc.id, name: doc.name, tabs: result.tabs });
            setSheetName(result.tabs[0] ?? '');
          } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read spreadsheet tabs.'); }
          finally { setBusy(false); }
        }).build();
      picker.setVisible(true);
      const openedAt = Date.now();
      pickerProbe.current = window.setInterval(() => {
        const frameOpened = Array.from(document.querySelectorAll('iframe')).some((frame) => frame.src.includes('picker'));
        if (frameOpened) return clearPickerProbe();
        if (Date.now() - openedAt > 12000) {
          clearPickerProbe();
          picker.setVisible(false);
          setMessage('Google Picker did not open in this browser. Try opening the app in Chrome or Edge, then connect your tracker again.');
        }
      }, 250);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open Google Picker.');
    } finally { setBusy(false); }
  }

  async function saveConnection() {
    if (!picked || !sheetName) return;
    const existing = connections[0];
    if (existing && !window.confirm(`You already have a tracker connected (${existing.spreadsheet_name} · ${existing.sheet_name}). Replace it with "${picked.name}" · ${sheetName}?`)) return;
    setBusy(true); setMessage('');
    let connectionId: string | null = null;
    if (existing) {
      const response = await fetch(`/api/sheet-connections/${existing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spreadsheetId: picked.id, spreadsheetName: picked.name, sheetName }) });
      const result = await response.json();
      if (!response.ok) { setBusy(false); return setMessage(result.error || 'Could not update the tracker connection.'); }
      connectionId = existing.id;
    } else {
      const response = await fetch('/api/sheet-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spreadsheetId: picked.id, spreadsheetName: picked.name, sheetName }) });
      const result = await response.json();
      if (!response.ok) { setBusy(false); return setMessage(result.error || 'Could not save spreadsheet connection.'); }
      connectionId = result.id;
    }
    if (!connectionId) { setBusy(false); return setMessage('Could not save spreadsheet connection.'); }
    try {
      setImporting(true);
      const importResponse = await fetch(`/api/sheet-connections/${connectionId}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}` } });
      const importResult = await importResponse.json();
      if (!importResponse.ok) throw new Error(importResult.error || 'Could not import spreadsheet.');
      if (importResult.removals && importResult.removals.length > 0) {
        setImporting(false);
        setRemovals({ connectionId: connectionId, items: importResult.removals });
        return;
      }
      setMessage(importSummary(importResult));
      window.setTimeout(() => window.location.assign('/dashboard/overview'), importResult.skipped > 0 ? 4000 : 900);
    } catch (error) {
      setImporting(false);
      setBusy(false);
      setMessage(error instanceof Error ? error.message : 'Could not import spreadsheet.');
    }
  }

  async function importConnection(connectionId: string) {
    setBusy(true); setMessage('');
    try {
      token.current = await authorize();
      setImporting(true);
      const response = await fetch(`/api/sheet-connections/${connectionId}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Import failed.');
      if (result.removals && result.removals.length > 0) {
        setImporting(false);
        setRemovals({ connectionId, items: result.removals });
        return;
      }
      setMessage(importSummary(result));
      window.setTimeout(() => window.location.assign('/dashboard/overview'), result.skipped > 0 ? 4000 : 900);
    } catch (error) { setImporting(false); setMessage(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setBusy(false); }
  }

  return <div>
    <button disabled={busy} onClick={openPicker}>{busy ? 'Working…' : 'Connect or import your tracker'}</button>
    {picked && <div className="connection-panel">
      <p><strong>{picked.name}</strong></p>
      <label htmlFor="sheet-name">Sheet tab</label>
      <select id="sheet-name" value={sheetName} onChange={(event) => setSheetName(event.target.value)}>{picked.tabs.map((tab) => <option key={tab}>{tab}</option>)}</select>
      <button disabled={!sheetName || busy} onClick={saveConnection}>{connections.length > 0 ? 'Replace connected tracker with this tab' : 'Connect this tab'}</button>
    </div>}
    {connections.length > 0 && <div className="connections"><h2>Connected spreadsheets</h2>{connections.map((connection) => <div className="connection-row" key={connection.id}><span><strong>{connection.spreadsheet_name}</strong><small>{connection.sheet_name}</small></span><button disabled={busy} onClick={() => importConnection(connection.id)}>Import from Sheet</button></div>)}</div>}
    {message && <p className="message" role="status">{message}</p>}
    {importing && <div className="importing-overlay" role="status" aria-live="polite"><div className="importing-dialog"><img className="cat-img" src="/cat-run.gif" alt="Running cat" /><p>Importing your spreadsheet…</p><div className="importing-track" aria-hidden="true"><span/><span/><span/></div></div></div>}
    {removals && <RemovalsConfirm connectionId={removals.connectionId} removals={removals.items} onDone={() => { setRemovals(null); window.location.assign('/dashboard/overview'); }} />}
  </div>;
}
