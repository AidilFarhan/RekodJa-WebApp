'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function WorkspaceNav({ actionsCount = 0 }: { actionsCount?: number }) {
  const pathname = usePathname();
  const onOverview = pathname.startsWith('/dashboard/overview');
  const onAnalytics = pathname.startsWith('/dashboard/analytics');
  const onActions = pathname.startsWith('/dashboard/actions');
  const onSettings = pathname.startsWith('/dashboard/settings');
  const onGmailScan = pathname.startsWith('/dashboard/gmail-scan');
  const onApplications = pathname === '/dashboard' || (pathname.startsWith('/dashboard/') && !onOverview && !onAnalytics && !onActions && !onSettings && !onGmailScan);
  return <nav aria-label="Workspace">
    <Link href="/dashboard/overview" aria-current={onOverview ? 'page' : undefined}>◫　 Overview</Link>
    <Link href="/dashboard" aria-current={onApplications ? 'page' : undefined}>▤　 Applications</Link>
    <Link href="/dashboard/actions" aria-current={onActions ? 'page' : undefined}>✦　 Actions{actionsCount > 0 && <span className="nav-count">{actionsCount}</span>}</Link>
    <Link href="/dashboard/gmail-scan" aria-current={onGmailScan ? 'page' : undefined}>✉　 Gmail Scan</Link>
    <Link href="/dashboard/analytics" aria-current={onAnalytics ? 'page' : undefined}>▦　 Analytics</Link>
    <a href="https://jobtracker.aidilfarhanjassim.online/" target="_blank" rel="noreferrer" onClick={(event) => { if (!window.confirm('Open the Job Tracker extension website?')) event.preventDefault(); }}>✚　 Extension</a>
  </nav>;
}
