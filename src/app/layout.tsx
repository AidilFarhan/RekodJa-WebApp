import { Suspense } from 'react';
import Script from 'next/script';
import CatLoader from '@/components/cat-loader';
import './globals.css';
import './responsive.css';
export const metadata = { title: 'RekodJa: Job Tracker', description: 'Your RekodJa: Job Tracker account' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Script id="rekodja-theme" strategy="beforeInteractive">{`try { const theme = localStorage.getItem('rekodja-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch {}`}</Script><header><a href="/" className="header-brand"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span></a></header><main>{children}</main><Suspense fallback={null}><CatLoader /></Suspense></body></html>;
}
