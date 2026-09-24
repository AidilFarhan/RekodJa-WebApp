'use client';
import Link from 'next/link';
import { useRef } from 'react';
import { PRO_REQUIRED_MESSAGE } from '@/lib/billing/plans';

export default function ProGateButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className="button primary" onClick={() => dialog.current?.showModal()}>Scan Gmail · Pro locked</button>
    <dialog ref={dialog} aria-labelledby="pro-required-title" style={{ maxWidth: 440, borderRadius: 16, padding: 24 }}>
      <h2 id="pro-required-title">Gmail scan requires Pro</h2>
      <p>{PRO_REQUIRED_MESSAGE}</p>
      <div className="button-row">
        <Link className="button primary" href="/dashboard/settings#billing" onClick={() => dialog.current?.close()}>Continue to subscribe</Link>
        <button className="button" onClick={() => dialog.current?.close()}>Skip for now</button>
      </div>
    </dialog>
  </>;
}
