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

    /*
      Persist the review queue so refresh doesn't lose scan results (or
      re-spend Gmail quota). Review state and confirmed stage are not
      included in the upsert payload, so a rescan refreshes the data
      without resetting an existing 'confirmed' or 'dismissed' review.
    */
    const payload = result.candidates.map((candidate) => ({
      user_id: user.id,
      message_id: candidate.messageId,
      thread_id: candidate.threadId,
      email: candidate.email,
      internal_date_ms: Number(candidate.internalDate) || 0,
      subject: candidate.subject.slice(0, 500),
      sender_from: candidate.from.slice(0, 500),
      sender_email: candidate.sender.slice(0, 320),
      snippet: candidate.snippet.slice(0, 1600),
      suggested_company: candidate.suggested.company.slice(0, 200),
      suggested_role: candidate.suggested.role.slice(0, 200),
      suggested_status: candidate.suggested.status.slice(0, 20),
      event_type: candidate.eventType ?? 'stage_observation',
      matched_application_id: candidate.match?.applicationId ?? null,
      updated_at: new Date().toISOString(),
    }));

    let savedCandidates = 0;
    if (payload.length) {
      const { error: candidatesError } = await client
        .from('gmail_scan_candidates')
        .upsert(payload, { onConflict: 'user_id,message_id' });
      if (candidatesError) throw new Error('Could not save the scan results.');
      savedCandidates = payload.length;
    }

    return NextResponse.json({ ...result, savedCandidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Gmail scan failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
