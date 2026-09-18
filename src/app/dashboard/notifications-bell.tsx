'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Issue = { id: string; message: string };

export default function NotificationsBell({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);
  async function dismiss(id?: string) {
    const response = await fetch('/api/import-issues' + (id ? `/${id}` : ''), { method: 'DELETE' });
    if (response.ok) router.refresh();
  }
  return <div className="notifications" ref={rootRef}>
    <button className="bell" aria-label={`${issues.length} notification${issues.length === 1 ? '' : 's'}`} onClick={() => setOpen((value) => !value)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>
      {issues.length > 0 && <span className="bell-count">{issues.length}</span>}
    </button>
    {open && <div className="notification-panel">
      <div className="notification-head"><strong>Notifications</strong>{issues.length > 0 && <button className="text-button" onClick={() => dismiss()}>Dismiss all</button>}</div>
      {issues.length === 0 ? <p className="panel-empty">All clear — nothing needs your attention.</p> : <ul className="notification-list">{issues.map((issue) => <li key={issue.id}><span>{issue.message}</span><button className="dismiss" aria-label="Dismiss" onClick={() => dismiss(issue.id)}>✕</button></li>)}</ul>}
    </div>}
  </div>;
}
