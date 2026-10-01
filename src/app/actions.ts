'use server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { configuration } from '@/lib/config';
import { cookies } from 'next/headers';
import { readSubscription } from '@/lib/billing/server';
import { isTerminalSubscription } from '@/lib/billing/plans';

function settingsError(message: string) {
  return `/dashboard/settings?error=${encodeURIComponent(message)}`;
}

export async function signIn() {
  return startGoogleAuth('login');
}
export async function createAccount() {
  return startGoogleAuth('signup');
}
async function startGoogleAuth(intent: 'login' | 'signup') {
  const jar = await cookies();
  jar.set('rekodja-auth-intent', intent, { httpOnly: true, sameSite: 'lax', secure: configuration().appUrl.startsWith('https://'), path: '/', maxAge: 600 });
  const client = await supabase();
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
    scopes: 'openid email profile', redirectTo: `${configuration().appUrl}/auth/callback`,
    queryParams: { prompt: 'select_account' },
  } });
  if (error || !data.url) redirect('/sign-in?error=oauth');
  redirect(data.url);
}
export async function signOut() {
  const client = await supabase();
  const { error } = await client.auth.signOut();
  if (error) redirect('/account?error=signout');
  redirect('/sign-in');
}
export async function deleteAccount() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  // Stripe keeps charging a subscription after the account is gone, so a
  // running one must be cancelled first. One already set to end at the period
  // end will not charge again.
  let subscription: Awaited<ReturnType<typeof readSubscription>> = null;
  let subscriptionChecked = true;
  try { subscription = await readSubscription(client, user.id); } catch { subscriptionChecked = false; }
  if (!subscriptionChecked) redirect(settingsError('We could not check your subscription, so nothing was deleted. Please try again.'));
  if (subscription && !isTerminalSubscription(subscription.status) && !subscription.cancel_at_period_end) {
    redirect(settingsError('Cancel your subscription in Manage billing before deleting your account, so you are not charged again.'));
  }
  // Gmail scan results go through a function because the Pro-only policy would
  // otherwise hide them from a non-subscriber's own DELETE.
  const deletions = [
    () => client.rpc('delete_own_gmail_scan_candidates'),
    () => client.from('import_issues').delete().eq('user_id', user.id),
    () => client.from('application_events').delete().eq('user_id', user.id),
    () => client.from('applications').delete().eq('user_id', user.id),
    () => client.from('sheet_connections').delete().eq('user_id', user.id),
    () => client.from('profiles').delete().eq('id', user.id),
  ];
  for (const run of deletions) {
    const { error } = await run();
    if (error) redirect(settingsError('Your account could not be fully deleted. Please try again.'));
  }
  await client.auth.signOut();
  redirect('/sign-in?deleted=1');
}
export async function saveProfile(form: FormData) {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const name = form.get('display_name');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) redirect('/account?error=name');
  const { data, error } = await client.from('profiles').upsert({ id: user.id, display_name: name.trim(), name_confirmed: true }, { onConflict: 'id' }).select('id').single();
  if (error || !data) redirect('/account?error=' + encodeURIComponent(error?.message || 'save'));
  redirect('/account?saved=1');
}

export async function saveProfileAndContinue(form: FormData) {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const name = form.get('display_name');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) redirect('/tracker-setup?error=name');
  const { data, error } = await client.from('profiles').upsert({ id: user.id, display_name: name.trim(), name_confirmed: true }, { onConflict: 'id' }).select('id').single();
  if (error || !data) redirect('/tracker-setup?error=' + encodeURIComponent(error?.message || 'save'));
  redirect('/tracker-setup?saved=1');
}
