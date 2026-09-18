'use client';

import { useState } from 'react';

export default function ErrorPopup({ message }: { message: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <div className="importing-overlay" role="alert"><div className="importing-dialog"><strong className="popup-title">Something went wrong</strong><p>{message}</p><button className="button" onClick={() => setOpen(false)}>Close</button></div></div>;
}
