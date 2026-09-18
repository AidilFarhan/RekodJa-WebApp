'use server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { configuration } from '@/lib/config';

export async function signIn() {
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
  await client.from('import_issues').delete().eq('user_id', user.id);
  await client.from('application_events').delete().eq('user_id', user.id);
  await client.from('applications').delete().eq('user_id', user.id);
  await client.from('sheet_connections').delete().eq('user_id', user.id);
  await client.from('profiles').delete().eq('id', user.id);
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
