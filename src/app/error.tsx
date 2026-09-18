'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section><h1>Unable to load your account</h1><p>Please try again. If this continues, the administrator should check the Supabase environment and database setup.</p><button onClick={reset}>Try again</button></section>;
}
