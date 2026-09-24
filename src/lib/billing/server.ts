import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabase } from '../supabase';
import { isPro, type ProSubscription } from './access';
import { TEST_SUPABASE_URL, TEST_APP_URL, assertTestEnvironment } from './test-environment.mjs';
import { PRO_REQUIRED_MESSAGE } from './plans';

export class BillingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function billingTestEnabled() {
  return process.env.SUPABASE_URL === TEST_SUPABASE_URL && process.env.APP_URL === TEST_APP_URL;
}
export async function readSubscription(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('subscriptions')
    .select('status,trial_end,current_period_end,past_due_at,cancel_at_period_end,price_lookup_key,has_used_trial')
    .eq('user_id', userId).maybeSingle();
  if (error) throw new BillingError(503, 'Billing status is temporarily unavailable.');
  return data as (ProSubscription & { price_lookup_key: string; has_used_trial: boolean }) | null;
}
export async function userHasPro(client: SupabaseClient, userId: string) {
  // Staged rollout: leave the existing production beta behavior unchanged.
  if (!billingTestEnabled()) return true;
  return isPro(await readSubscription(client, userId));
}
export async function gmailAccessError(client: SupabaseClient, userId: string) {
  try {
    if (await userHasPro(client, userId)) return null;
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
