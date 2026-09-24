import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import GmailScanClient from './gmail-scan-client';
import { gmailAccessAllowed, gmailAccessKind } from '@/lib/billing/server';
import ProGateButton from '../pro-gate-button';

export const dynamic = 'force-dynamic';

export default async function GmailScanPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  if (!gmailAccessAllowed(await gmailAccessKind(client, user))) return <section className="gmail-scan-page">
    <h1>Gmail scan</h1><p>Your saved applications remain available. Subscribe to Pro to scan and review Gmail.</p>
    <ProGateButton />
  </section>;
  const { data: applications, error: applicationsError } = await client
    .from('applications')
    .select('id, company, role, job_url')
    .eq('user_id', user.id);
  if (applicationsError) throw new Error('Could not load applications.');
  const clientId = googlePickerConfiguration()?.clientId ?? '';
  return <section className="gmail-scan-page">
    <h1>Gmail scan</h1>
    <p className="page-subtitle">Showing your email from the last 45 days.</p>
    <GmailScanClient clientId={clientId} applications={(applications ?? []) as { id: string; company: string; role: string; job_url: string }[]} />
  </section>;
}
