'use client';

import { useEffect, useRef, useState } from 'react';

const EDGE_PEEK_PX = 8;
const HIDE_DELAY_MS = 600;

export default function SidebarController({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const collapsedRef = useRef(false);
  const openRef = useRef(false);

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
    const onToggle = () => {
      const next = !openRef.current;
      openRef.current = next;
      setOpen(next);
      cancelHide();
      if (next) setCollapsedState(false);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (openRef.current) return;
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
    window.addEventListener('jt-sidebar-toggle', onToggle);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('jt-sidebar-toggle', onToggle); cancelHide(); };
  }, []);

  return <div className={'workspace' + (collapsed && !open ? ' sidebar-collapsed' : '')}>{children}</div>;
}
