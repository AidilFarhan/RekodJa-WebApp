import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { googlePickerConfiguration } from '@/lib/google-config';
import GmailScanClient from './gmail-scan-client';

export const dynamic = 'force-dynamic';

export default async function GmailScanPage() {
  const client = await supabase();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) redirect('/sign-in');
  const { data: applications, error: applicationsError } = await client
    .from('applications')
    .select('id, company, role, job_url')
    .eq('user_id', user.id);
  if (applicationsError) throw new Error('Could not load applications.');
  const clientId = googlePickerConfiguration()?.clientId ?? '';
  return <section className="gmail-scan-page">
    <p className="eyebrow">GMAIL SCAN</p>
    <h1>Gmail scan</h1>
    <p className="page-subtitle">Read application emails from the last 45 days, then review and confirm what changed.</p>
    <GmailScanClient clientId={clientId} applications={(applications ?? []) as { id: string; company: string; role: string; job_url: string }[]} />
  </section>;
}
