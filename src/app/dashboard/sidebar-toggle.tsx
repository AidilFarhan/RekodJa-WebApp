'use client';

export default function SidebarToggleButton() {
  return <button className="sidebar-toggle" aria-label="Toggle navigation" onClick={() => window.dispatchEvent(new CustomEvent('jt-sidebar-toggle'))}><span/><span/><span/></button>;
}
