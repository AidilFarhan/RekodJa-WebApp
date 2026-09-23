'use client';

import { useEffect, useRef } from 'react';
import { signIn } from '../actions';

export default function AccountNotice({ notice }: { notice: 'create-first' | 'already-exists' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function close() {
    dialog.current?.close();
    const url = new URL(window.location.href);
    url.searchParams.delete('notice');
    window.history.replaceState(null, '', url.pathname + url.search);
  }
  return <dialog ref={dialog} className="account-notice" aria-labelledby="account-notice-title" onCancel={close}>
    <p id="account-notice-title">{notice === 'create-first' ? 'Please create your account first' : 'You already have an account'}</p>
    {notice === 'create-first' ? <button autoFocus type="button" className="sign-in-button" onClick={close}>Okay</button> : <form action={signIn}><button autoFocus type="submit" className="sign-in-button">Log in with Google</button></form>}
  </dialog>;
}
