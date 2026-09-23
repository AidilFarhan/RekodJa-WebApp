'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SettingsLink() {
  const pathname = usePathname();
  const active = pathname.startsWith('/dashboard/settings');
  return <Link href="/dashboard/settings" className={active ? 'selected' : undefined}>Settings</Link>;
}
