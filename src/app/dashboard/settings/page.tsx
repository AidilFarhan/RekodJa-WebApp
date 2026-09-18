import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/app/actions';
import DeleteAccountButton from './delete-account-button';
import ErrorPopup from './error-popup';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const params = await searchParams;
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const [{ data: profile }, { data: connections }] = await Promise.all([
    client.from('profiles').select('display_name').eq('id', user.id).single(),
    client.from('sheet_connections').select('id, spreadsheet_name, sheet_name').order('created_at'),
  ]);
  const name = profile?.display_name || 'Your account';
  const initials = name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join('').toUpperCase();
  return <section className="settings-page">
    <h1>Settings</h1>
    <p className="page-subtitle">Manage your workspace connections and plan.</p>
    {params.saved && <p className="feedback" role="status">Your name has been saved.</p>}
    {params.error && params.error !== 'save' && <ErrorPopup message={decodeURIComponent(params.error)} />}
    <div className="settings-sections">
      <section>
        <div><h2>Account</h2><p>{name}</p><p className="muted">{user.email} · Google Account</p></div>
        <div className="button-row"><Link className="button" href="/tracker-setup?view=onboarding">Edit name</Link><span className="avatar">{initials}</span></div>
      </section>
      <section>
        <div>
          <h2>Google Sheet</h2>
          <p>{connections && connections.length > 0 ? `Connected to: ${connections.map((connection) => `${connection.spreadsheet_name} · ${connection.sheet_name}`).join(', ')}` : 'Not connected'}</p>
          <p className="muted">We only access the file you selected. Connect to import your tracker.</p>
        </div>
        <div className="button-row"><Link className="button" href="/tracker-setup">{connections && connections.length > 0 ? 'Change Tracker' : 'Connect Tracker'}</Link></div>
      </section>
      <section>
        <div>
          <h2>Gmail <span className="subtle-tag">Pro</span></h2>
          <p>Not connected</p>
          <p className="muted">Email observations arrive in a future version.</p>
        </div>
      </section>
      <section>
        <div>
          <h2>Plan</h2>
          <p>Job Tracker Free</p>
          <p className="muted">Pro plans are not available yet.</p>
        </div>
      </section>
      <section>
        <div><h2>Session</h2><p className="muted">Sign out of this device.</p></div>
        <form action={signOut}><button className="button">Sign out</button></form>
      </section>
      <section>
        <div><h2>Delete account</h2><p className="muted">Remove your account and all tracked data. This cannot be undone.</p></div>
        <DeleteAccountButton />
      </section>
    </div>
  </section>;
}
