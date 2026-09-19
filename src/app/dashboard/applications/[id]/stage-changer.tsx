'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STAGES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'];

export default function StageChanger({ applicationId, stage: initialStage }: { applicationId: string; stage: string }) {
  const [stage, setStage] = useState(initialStage);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function change(nextStage: string) {
    if (nextStage === stage) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/applications/${applicationId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: nextStage }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update the stage.');
      setStage(result.stage ?? nextStage);
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not update the stage.');
    } finally { setBusy(false); }
  }
  return <select className={'stage-select status-' + stage.toLowerCase()} value={stage} disabled={busy} onChange={(event) => change(event.target.value)} aria-label="Application stage">{STAGES.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}
