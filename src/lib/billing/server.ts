import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabase } from '../supabase';
import { isPro, type ProSubscription } from './access';
import { gmailAccess, type GmailAccess } from './beta';
import { userIsBetaTester } from './beta-server';
import { TEST_SUPABASE_URL, TEST_APP_URL, assertTestEnvironment } from './test-environment.mjs';
import { PRO_REQUIRED_MESSAGE } from './plans';

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function billingTestEnabled() {
  return process.env.SUPABASE_URL === TEST_SUPABASE_URL && process.env.APP_URL === TEST_APP_URL;
}
/** Whether the Gmail gate blocks anyone at all.
 *
 * Inside the isolated test environment it always does. In production it must be
 * switched on explicitly, so that shipping this code cannot silently revoke
 * Gmail access from people who already use it — the switch is the owner's
 * decision, not a side effect of a deploy.
 */
export function gmailGateEnforced() {
  return billingTestEnabled() || process.env.GMAIL_GATE_ENFORCED === '1';
}
/** A deployment without the billing tables has no subscribers at all. PostgREST
 * reports that as PGRST205 and Postgres as 42P01; either is a definite "no",
 * not an outage, so it must not surface as a 503 to every user.
 */
const MISSING_TABLE = new Set(['PGRST205', '42P01']);
export async function readSubscription(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('subscriptions')
    .select('status,trial_end,current_period_end,past_due_at,cancel_at_period_end,price_lookup_key,has_used_trial')
    .eq('user_id', userId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.has(error.code ?? '') || /could not find the table/i.test(error.message ?? '')) return null;
    throw new BillingError(503, 'Billing status is temporarily unavailable.');
  }
  return data as (ProSubscription & { price_lookup_key: string; has_used_trial: boolean }) | null;
}
/** Which source grants Gmail access for this user.
 *
 * `user` must be the object Supabase Auth returned for the session: its email is
 * the only address trusted for the beta list, never a request-supplied value.
 * Callers must pass the user object, not just the id, for that reason.
 */
export async function gmailAccessKind(client: SupabaseClient, user: { id: string; email?: string | null }): Promise<GmailAccess | 'open'> {
  if (!gmailGateEnforced()) return 'open';
  const betaEligible = userIsBetaTester(user.email);
  const hasSubscription = isPro(await readSubscription(client, user.id));
  return gmailAccess(hasSubscription, betaEligible);
}
export function gmailAccessAllowed(kind: GmailAccess | 'open') {
  return kind !== 'denied';
}
export async function gmailAccessError(client: SupabaseClient, user: { id: string; email?: string | null }) {
  try {
    if (gmailAccessAllowed(await gmailAccessKind(client, user))) return null;
    return NextResponse.json({ error: PRO_REQUIRED_MESSAGE, code: 'PRO_REQUIRED' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not verify Pro access.' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
export async function authenticatedBillingUser(request: Request) {
  assertTestEnvironment(process.env);
  if (request.headers.get('origin') !== TEST_APP_URL) throw new BillingError(403, 'Invalid request origin.');
  const client = await supabase();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new BillingError(401, 'Sign in before managing billing.');
  return user;
}
export function billingFailure(error: unknown) {
  return NextResponse.json({ error: error instanceof BillingError ? error.message : 'Billing is temporarily unavailable. Please retry later.' },
    { status: error instanceof BillingError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
}
