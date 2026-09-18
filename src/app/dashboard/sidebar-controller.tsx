'use client';

import { useEffect, useRef, useState } from 'react';

const EDGE_PEEK_PX = 8;
const HIDE_DELAY_MS = 600;

export default function SidebarController({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);

  useEffect(() => {
    if (window.matchMedia('(max-width: 600px)').matches) return;
    let hideTimer: number | null = null;
    const cancelHide = () => {
      if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
    };
    const setCollapsedState = (value: boolean) => {
      collapsedRef.current = value;
      setCollapsed(value);
    };
    const onMouseMove = (event: MouseEvent) => {
      const sidebar = document.querySelector('.workspace-sidebar');
      if (!sidebar) return;
      const rect = sidebar.getBoundingClientRect();
      if (!collapsedRef.current) {
        const overSidebar = event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (overSidebar) { cancelHide(); return; }
      }
      if (event.clientX <= EDGE_PEEK_PX) { cancelHide(); setCollapsedState(false); return; }
      if (!collapsedRef.current) {
        cancelHide();
        hideTimer = window.setTimeout(() => setCollapsedState(true), HIDE_DELAY_MS);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => { window.removeEventListener('mousemove', onMouseMove); cancelHide(); };
  }, []);

  return <div className={'workspace' + (collapsed ? ' sidebar-collapsed' : '')}>{children}</div>;
}
