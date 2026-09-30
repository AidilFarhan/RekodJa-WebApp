'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestGoogleToken } from '@/lib/google-token';

export default function DeleteApplicationButton({ applicationId, company, inSheet, clientId }: { applicationId: string; company: string; inSheet: boolean; clientId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function remove() {
    const warning = inSheet
      ? `Delete the application for ${company}? Its row will also be deleted from your Google Sheet. This cannot be undone.`
      : `Delete the application for ${company}? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    setBusy(true);
    try {
      // Imported applications are deleted from the sheet too, which needs a
      // Google token. The server refuses to delete anything without one.
      const headers: Record<string, string> = {};
      if (inSheet) {
        let googleToken = '';
        try { googleToken = await requestGoogleToken(clientId); } catch { googleToken = ''; }
        if (googleToken) headers.Authorization = `Bearer ${googleToken}`;
      }
      const response = await fetch(`/api/applications/${applicationId}`, { method: 'DELETE', headers });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not delete the application.');
      }
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not delete the application.');
      setBusy(false);
    }
  }
  return <button className="button danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete application'}</button>;
}
