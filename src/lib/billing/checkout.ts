import 'server-only';
import type Stripe from 'stripe';
import { verifiedStripe } from '../stripe/server';
import { supabaseAdmin } from '../supabase-admin';
import { BillingError } from './server';
import { isTerminalSubscription, SANDBOX_CARDS_CONFIG_NAME, type PlanKey, TRIAL_DAYS } from './plans';
import { validatePrice, resourceId } from './stripe-state';
import { TEST_APP_URL } from './test-environment.mjs';

type BillingCustomer = {
  user_id: string; stripe_customer_id: string | null;
  checkout_attempt_id: string | null; checkout_session_id: string | null;
  checkout_plan: PlanKey | null; checkout_price_id: string | null;
  checkout_trial: boolean | null; checkout_created_at: string | null;
  checkout_lease_until: string | null;
};
export async function getBillingCustomer(userId: string): Promise<BillingCustomer> {
  const admin = supabaseAdmin();
  const { error: insertError } = await admin.from('billing_customers').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (insertError) throw new Error('Could not initialize billing customer.');
  const { data, error } = await admin.from('billing_customers').select('*').eq('user_id', userId).single();
  if (error || !data) throw new Error('Could not read billing customer.');
  return data as BillingCustomer;
}
export async function resolvePrice(stripe: Stripe, plan: PlanKey) {
  const prices = await stripe.prices.list({ lookup_keys: [plan], active: true, limit: 2 });
  if (prices.data.length !== 1 || prices.has_more) throw new Error('Plan price is not configured.');
  validatePrice(prices.data[0], true);
  return prices.data[0];
}
export async function cardsConfiguration(stripe: Stripe) {
  const configs = await stripe.paymentMethodConfigurations.list({ limit: 100 });
  const config = configs.data.find(item => item.name === SANDBOX_CARDS_CONFIG_NAME && item.active && !item.livemode);
  if (!config || configs.has_more || config.card?.display_preference.value !== 'on') throw new Error('Cards-only Sandbox configuration is not ready.');
  for (const [name, value] of Object.entries(config)) {
    if (name !== 'card' && value && typeof value === 'object' && 'display_preference' in value &&
        (value.display_preference as { value: string }).value === 'on') {
      throw new Error('An unapproved payment method is enabled.');
    }
  }
  return config.id;
}
async function ensureCustomer(stripe: Stripe, userId: string) {
  let row = await getBillingCustomer(userId);
  if (!row.stripe_customer_id) {
    // Stable parameters and key; no email supplied by a mutable client request.
    const customer = await stripe.customers.create({ metadata: { rekodja_user_id: userId } }, { idempotencyKey: `rekodja-customer-${userId}` });
    const { error } = await supabaseAdmin().from('billing_customers').update({ stripe_customer_id: customer.id })
      .eq('user_id', userId).is('stripe_customer_id', null);
    if (error) throw new Error('Could not persist customer mapping.');
    row = await getBillingCustomer(userId);
  }
  if (!row.stripe_customer_id) throw new Error('Billing customer is not ready.');
  const customer = await stripe.customers.retrieve(row.stripe_customer_id);
  if (customer.deleted || customer.livemode) throw new Error('Invalid billing customer.');
  return row as BillingCustomer & { stripe_customer_id: string };
}
export async function createCheckout(userId: string, plan: PlanKey) {
  const stripe = await verifiedStripe();
  if (!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) throw new BillingError(503, 'The Sandbox webhook must be configured before Checkout.');
  const [price, paymentConfiguration] = await Promise.all([resolvePrice(stripe, plan), cardsConfiguration(stripe)]);
  const customer = await ensureCustomer(stripe, userId);
  const admin = supabaseAdmin();
  const { data: previous, error: previousError } = await admin.from('subscriptions').select('has_used_trial').eq('user_id', userId).maybeSingle();
  if (previousError) throw new Error('Could not check trial history.');
  let usedTrial = Boolean(previous?.has_used_trial);
  for await (const subscription of stripe.subscriptions.list({ customer: customer.stripe_customer_id, status: 'all', limit: 100 })) {
    if (!isTerminalSubscription(subscription.status)) throw new BillingError(409, 'You already have a subscription. Manage it in Settings.');
    usedTrial ||= subscription.trial_start !== null || subscription.trial_end !== null;
  }
  // Claim is an atomic row lock in Postgres. All concurrent tabs receive the
  // same attempt and immutable plan/trial inputs, not a new idempotency key.
  const { data: claimed, error: claimError } = await admin.rpc('claim_stripe_checkout', {
    p_user_id: userId, p_plan: plan, p_price_id: price.id, p_trial: !usedTrial,
  });
  if (claimError || !claimed) throw new Error('Could not claim Checkout.');
  const row = claimed as BillingCustomer;
  if (!row.checkout_attempt_id || !row.checkout_price_id || !row.checkout_lease_until || row.checkout_trial === null) throw new Error('Incomplete Checkout attempt.');
  let session: Stripe.Checkout.Session;
  if (row.checkout_session_id) {
    session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
  } else {
    // Do not retry an unknown result after Stripe's idempotency retention. A
    // short cutoff also prevents retry parameters with an invalid expires_at.
    if (Date.parse(row.checkout_lease_until) - Date.now() < 31 * 60 * 1000) {
      throw new BillingError(409, 'Checkout recovery is required. Please contact support; no new session was created.');
    }
    session = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customer.stripe_customer_id,
      client_reference_id: userId, line_items: [{ price: row.checkout_price_id, quantity: 1 }],
      payment_method_configuration: paymentConfiguration,
      payment_method_collection: 'always',
      subscription_data: row.checkout_trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {},
      expires_at: Math.floor(Date.parse(row.checkout_lease_until) / 1000),
      success_url: `${TEST_APP_URL}/dashboard/settings?billing=success`,
      cancel_url: `${TEST_APP_URL}/dashboard/settings?billing=canceled`,
      integration_identifier: 'rekodja_sandbox_kjmnprst',
      metadata: { checkout_attempt_id: row.checkout_attempt_id },
    }, { idempotencyKey: `rekodja-checkout-${row.checkout_attempt_id}` });
    const { error } = await admin.from('billing_customers').update({ checkout_session_id: session.id })
      .eq('user_id', userId).eq('checkout_attempt_id', row.checkout_attempt_id);
    if (error) throw new Error('Could not persist Checkout session.');
  }
  if (session.livemode || resourceId(session.customer) !== customer.stripe_customer_id) throw new Error('Invalid Checkout owner.');
  if (session.status === 'expired' || session.status === 'complete') {
    // All subscriptions were checked above; never discard an unknown/open
    // session just because the local lease expired.
    const { error } = await admin.from('billing_customers').update({
      checkout_attempt_id: null, checkout_session_id: null, checkout_plan: null,
      checkout_price_id: null, checkout_trial: null, checkout_created_at: null, checkout_lease_until: null,
    }).eq('user_id', userId).eq('checkout_attempt_id', row.checkout_attempt_id);
    if (error) throw new Error('Could not close Checkout attempt.');
    throw new BillingError(409, 'The previous Checkout has ended. Refresh Settings and try again.');
  }
  if (row.checkout_plan !== plan) throw new BillingError(409, 'A Checkout for another plan is already open. Finish it or wait until it expires before choosing a different plan.');
  if (!session.url || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new Error('Invalid Checkout URL.');
  return session.url;
}
