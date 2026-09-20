'use client';

/*
  Root-level error boundary (replaces the whole <html> when the root
  layout itself fails). Without this, a server render error shows the
  raw "Minified React error #441" overlay with only a digest.
*/
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fafaf9', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <main style={{ maxWidth: 620, margin: '0 auto', padding: '56px 24px', color: '#252525' }}>
          <a href="/" style={{ textDecoration: 'none' }}>
            <span style={{ fontFamily: '"Times New Roman", Times, serif', fontWeight: 700, color: '#000' }}>
              Rekod
              <span style={{ fontWeight: 400, fontStyle: 'italic', color: '#0061e9' }}>Ja</span>
            </span>
          </a>
          <h1 style={{ fontSize: 24, margin: '28px 0 12px' }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.6 }}>RekodJa hit an unexpected problem while loading this page. Please try again.</p>
          <button
            onClick={reset}
            style={{ marginTop: 10, padding: '10px 20px', background: '#14213d', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer', fontSize: 14 }}
          >
            Try again
          </button>
          <p style={{ marginTop: 22, fontSize: 11, color: '#626976', overflowWrap: 'anywhere' }}>
            Technical detail: {error?.message || 'No message'}
            {error?.digest ? ` (digest ${error.digest})` : ''}
          </p>
        </main>
      </body>
    </html>
  );
}
