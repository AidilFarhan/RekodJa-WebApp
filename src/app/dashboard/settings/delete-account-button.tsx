'use client';

import { deleteAccount } from '@/app/actions';

export default function DeleteAccountButton() {
  return <form action={deleteAccount} onSubmit={(event) => {
    if (!window.confirm('Delete your account and all your data? This cannot be undone.')) event.preventDefault();
  }}><button className="button danger">Delete account</button></form>;
}
