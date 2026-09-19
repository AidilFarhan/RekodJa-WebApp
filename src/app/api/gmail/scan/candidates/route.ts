import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

/*
 * GET /api/gmail/scan/candidates — restore the saved review queue so a
 * page refresh never loses scan results.
 */
export async function GET() {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { data, error } = await client
    .from('gmail_scan_candidates')
    .select('id, message_id, thread_id, email, internal_date_ms, subject, sender_from, sender_email, snippet, suggested_company, suggested_role, suggested_status, event_type, matched_application_id, review_state, confirmed_stage, created_at')
    .eq('user_id', user.id)
    .order('internal_date_ms', { ascending: false });
  if (error) return NextResponse.json({ error: 'Could not load scan results.' }, { status: 500 });
  return NextResponse.json({ candidates: data ?? [] });
}

/*
 * PATCH /api/gmail/scan/candidates — dismiss (or reopen) one candidate.
 * Dismissed candidates stay in the table, so a rescan keeps them hidden
 * instead of bringing them back.
 */
export async function PATCH(request: NextRequest) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { messageId?: string; reviewState?: string };
  const messageId = String(body.messageId ?? '').trim();
  if (!messageId || !['dismissed', 'pending'].includes(body.reviewState ?? '')) {
    return NextResponse.json({ error: 'Message id and a valid review state are required.' }, { status: 400 });
  }
  const { data: updated, error } = await client
    .from('gmail_scan_candidates')
    .update({ review_state: body.reviewState, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('message_id', messageId)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not update the scan result.' }, { status: 500 });
  if (!updated) return NextResponse.json({ error: 'Scan result not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, reviewState: body.reviewState });
}
