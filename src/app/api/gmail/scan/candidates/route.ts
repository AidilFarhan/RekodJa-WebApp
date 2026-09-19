import { NextResponse } from 'next/server';
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
