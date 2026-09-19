'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/*
  Global cat loading popup: appears the moment the user starts
  navigating anywhere in the app (internal link click, back/forward)
  and disappears once the new page has loaded.
*/
export default function CatLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigation completed: the path (or query) has been updated.
  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 300);
  }, [pathname, searchParams]);

  useEffect(() => {
    const start = () => {
      setVisible(true);
      // Safety net: never leave the popup stuck if something unexpected happens.
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setVisible(false), 8000);
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
      start();
    };

    const onPopState = () => start();

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
    };
  }, []);

  if (!visible) return null;
  return <div className="importing-overlay" role="status" aria-live="polite"><div className="importing-dialog"><img className="cat-img" src="/cat-run.gif" alt="Running cat" /><p>Loading…</p><div className="importing-track" aria-hidden="true"><span/><span/><span/></div></div></div>;
}
