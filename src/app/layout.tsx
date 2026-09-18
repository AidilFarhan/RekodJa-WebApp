import './globals.css';
import './responsive.css';
export const metadata = { title: 'Job Tracker Pro', description: 'Your Job Tracker Pro account' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><header><a href="/">Job Tracker <strong>Pro</strong></a><nav aria-label="Primary"><a href="/dashboard">Dashboard</a><a href="/tracker-setup">Tracker</a><a href="/account">Account</a></nav></header><main>{children}</main></body></html>;
}
