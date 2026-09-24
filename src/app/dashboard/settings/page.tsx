import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/app/actions';
import { googlePickerConfiguration } from '@/lib/google-config';
import { billingView } from '@/lib/billing/overview';
import { planCard } from '@/lib/billing/presentation';
import BillingPanel from './billing-panel';
import DeleteAccountButton from './delete-account-button';
import ErrorPopup from './error-popup';
import SyncTrackerButton from './sync-tracker-button';

export const dynamic = 'force-dynamic';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; billing?: string }> }) {
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
  const pickerConfig = googlePickerConfiguration();
  const billing = await billingView(client, user);
  return <section className="settings-page">
    <h1>Settings</h1>
    <p className="page-subtitle">Manage your workspace connections and plan.</p>
    {params.saved && <p className="feedback" role="status">Your name has been saved.</p>}
    {/* The success URL never proves payment: Pro is only granted by a verified
        webhook, so this copy deliberately does not claim Pro is active. */}
    {params.billing === 'success' && <p className="feedback" role="status">Checkout finished. Pro turns on as soon as Stripe confirms the subscription.</p>}
    {params.billing === 'canceled' && <p className="feedback" role="status">Checkout canceled. Nothing was charged.</p>}
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
        <div className="button-row">
          {connections && connections.length > 0 && pickerConfig && connections.map((connection) => <SyncTrackerButton key={connection.id} connectionId={connection.id} clientId={pickerConfig.clientId} />)}
          <Link className="button" href="/tracker-setup?view=change">{connections && connections.length > 0 ? 'Change Tracker' : 'Connect Tracker'}</Link>
        </div>
      </section>
      <section>
        <div>
          <h2>Gmail <span className="subtle-tag">Pro</span></h2>
          <p>Not connected</p>
          <p className="muted">Gmail scanning requires Pro. Your saved applications stay available either way.</p>
        </div>
      </section>
      <section className="plan-section">
        <h2>Plan</h2>
        {billing
          ? <BillingPanel card={planCard(billing, formatDate)} />
          : <p className="muted">Pro plans are not available yet.</p>}
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
