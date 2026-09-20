import { Suspense } from 'react';
import CatLoader from '@/components/cat-loader';
import './globals.css';
import './responsive.css';
export const metadata = { title: 'RekodJa: Job Tracker', description: 'Your RekodJa: Job Tracker account' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><header><a href="/" className="header-brand"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span></a></header><main>{children}</main><Suspense fallback={null}><CatLoader /></Suspense></body></html>;
}
