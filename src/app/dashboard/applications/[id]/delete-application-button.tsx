'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteApplicationButton({ applicationId, company }: { applicationId: string; company: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function remove() {
    if (!window.confirm(`Delete the application for ${company}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}`, { method: 'DELETE' });
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
