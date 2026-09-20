import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import { saveProfile, signOut } from '../actions';
import TrackerSetup from './tracker-setup';

export const dynamic = 'force-dynamic';

export default async function TrackerSetupPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; view?: string }> }) {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const { data: profile, error: profileError } = await client.from('profiles').select('display_name, name_confirmed').eq('id', user.id).maybeSingle();
  const { data, error } = await client
    .from('sheet_connections')
    .select('id, spreadsheet_name, sheet_name')
    .order('created_at');
  if (error) throw new Error('Could not load tracker connections.');
  const { count: applicationCount, error: applicationsError } = await client.from('applications').select('id', { count: 'exact', head: true });
  if (applicationsError) throw new Error('Could not load applications.');
  const params = await searchParams;
  if (params.view !== 'onboarding' && params.view !== 'change' && data && data.length > 0 && (applicationCount ?? 0) > 0) redirect('/dashboard/overview');
  const googleConfig = googlePickerConfiguration();
  const accountView = params.view === 'onboarding';
  return <section className="onboarding-page">
    <div className="onboarding-skip-row"><a className="onboarding-skip" href="/dashboard/overview">Skip setup for now →</a></div>
    <p className="eyebrow">WELCOME TO REKODJA</p>
    <h1>View your application with ease</h1>
    {accountView ? <div className="onboarding-card">
      <p className="onboarding-card-eyebrow">Account</p>
      <h2>What should we call you?</h2>
      {params.error && <p role="alert" className="error">Please enter a name between 1 and 80 characters.</p>}
      {profileError ? <p role="alert">Your profile could not be loaded.</p> : <form action={saveProfile}>
        <label htmlFor="display_name">Your name</label>
        <input id="display_name" name="display_name" autoComplete="given-name" required maxLength={80} defaultValue={profile?.display_name ?? ''} />
        <button>Save name</button>
      </form>}
    </div> : <div className="onboarding-card">
      <h2>Let’s connect your spreadsheet</h2>
      {data && data.length > 0 && <p role="status" className="message">Your spreadsheet has been connected.</p>}
      <p>Choose the Google Sheet you use to track applications. We only request access to the file you select.</p>
      {!googleConfig ? <p role="status" className="message">Google Picker is not configured yet. Add the three Google Picker environment values described in the project README.</p> : <TrackerSetup config={googleConfig} connections={data ?? []}/>}
    </div>}
    <form action={signOut}><button className="secondary">Sign out</button></form>
  </section>;
}
