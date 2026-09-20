'use client';
import { useEffect } from 'react';
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[page error]', error); }, [error]);
  return <section><h1>Unable to load your account</h1><p>Please try again. If this continues, the administrator should check the Supabase environment and database setup.</p><p className="error">Technical detail: {error?.message || 'No message'}{error?.digest ? ` (digest ${error.digest})` : ''}</p><button onClick={reset}>Try again</button></section>;
}
