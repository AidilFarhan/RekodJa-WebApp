import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scanGmail, GMAIL_READONLY_SCOPE } from '@/lib/gmail/scan-engine';
import type { ApplicationRecord } from '@/lib/gmail/scan-core';

export const runtime = 'nodejs';
export const maxDuration = 300;

/*
 * POST /api/gmail/scan — read-only scan. No DB writes.
 *
 * Headers: Authorization: Bearer <GIS access token with gmail.readonly>
 * Returns: { email, scanned, skipped, candidates }
 */
export async function POST(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Google authorization required.' }, { status: 400 });

  // Verify the token actually grants Gmail read access before spending quota.
  const tokenInfoUrl = 'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token);
  const tokenInfoResponse = await fetch(tokenInfoUrl, { cache: 'no-store' });
  if (!tokenInfoResponse.ok) {
    return NextResponse.json({ error: 'Google access is invalid or expired. Reconnect Gmail access and try again.' }, { status: 401 });
  }
  const tokenInfo = (await tokenInfoResponse.json()) as { scope?: string; expires_in?: number };
  const grantedScopes = (tokenInfo.scope ?? '').split(/\s+/);
  if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
    return NextResponse.json({ error: 'Google access does not include Gmail read permission. Reconnect and allow Gmail access.' }, { status: 403 });
  }

  const { data: applications, error: applicationsError } = await client
    .from('applications')
    .select('id, company, role, job_url')
    .eq('user_id', user.id);
  if (applicationsError) return NextResponse.json({ error: 'Could not load your applications.' }, { status: 500 });

  try {
    const result = await scanGmail(token, (applications ?? []) as ApplicationRecord[]);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Gmail scan failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
