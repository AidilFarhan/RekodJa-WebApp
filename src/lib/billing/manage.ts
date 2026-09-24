import 'server-only';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { verifiedStripe } from '../stripe/server';
import { supabaseAdmin } from '../supabase-admin';
import { BillingError } from './server';
import { getBillingCustomer, cardsConfiguration, resolvePrice } from './checkout';
import { canChangePlan, isTerminalSubscription, PLANS, SANDBOX_PORTAL, type PlanKey } from './plans';
import { resourceId, subscriptionSnapshot } from './stripe-state';
import { TEST_APP_URL } from './test-environment.mjs';

export async function currentSubscription(stripe: Stripe, userId: string) {
  const row = await getBillingCustomer(userId);
  if (!row.stripe_customer_id) throw new BillingError(409, 'No subscription to manage.');
  const running: Stripe.Subscription[] = [];
  for await (const subscription of stripe.subscriptions.list({ customer: row.stripe_customer_id, status: 'all', limit: 100 })) {
    if (!isTerminalSubscription(subscription.status)) running.push(subscription);
  }
  if (running.length !== 1 || running[0].livemode || resourceId(running[0].customer) !== row.stripe_customer_id) {
    throw new BillingError(409, 'No single manageable subscription was found.');
  }
  subscriptionSnapshot(running[0], userId, null); // validates product, currency, amount and quantity
  return running[0];
}

export async function createPortal(userId: string) {
  const stripe = await verifiedStripe();
  const row = await getBillingCustomer(userId);
  if (!row.stripe_customer_id) throw new BillingError(409, 'No billing account yet.');
  const [config, cardConfig] = await Promise.all([
    stripe.billingPortal.configurations.retrieve(SANDBOX_PORTAL), cardsConfiguration(stripe),
  ]);
  // A local server guard cannot intercept writes on Stripe's hosted portal.
  // Therefore the configuration itself must disable subscription updates.
  if (!config.active || config.livemode || config.features.subscription_update.enabled ||
      config.features.subscription_update.trial_update_behavior !== 'continue_trial' ||
      !config.features.subscription_cancel.enabled || config.features.subscription_cancel.mode !== 'at_period_end' ||
      config.features.subscription_cancel.proration_behavior !== 'none' ||
      !config.features.payment_method_update.enabled ||
      config.features.payment_method_update.payment_method_configuration !== cardConfig) {
    throw new BillingError(503, 'Portal settings need review before continuing.');
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id, configuration: SANDBOX_PORTAL,
    return_url: `${TEST_APP_URL}/dashboard/settings`,
  });
  if (new URL(session.url).origin !== 'https://billing.stripe.com') throw new Error('Invalid portal URL.');
  return session.url;
}

export async function manageSubscription(userId: string, action: 'cancel' | 'change_plan', plan?: PlanKey) {
  const stripe = await verifiedStripe();
  const admin = supabaseAdmin();
  await getBillingCustomer(userId);
  const operationId = randomUUID();
  const { data: lock, error: lockError } = await admin.from('billing_customers').update({
    mutation_id: operationId, mutation_kind: action, mutation_started_at: new Date().toISOString(),
  }).eq('user_id', userId).is('mutation_id', null).select('user_id').maybeSingle();
  if (lockError) throw new Error('Could not lock billing operation.');
  if (!lock) throw new BillingError(409, 'A billing change is already processing. If it persists, contact support.');
  let writeStarted = false;
  let completed = false;
  try {
    const subscription = await currentSubscription(stripe, userId);
    if (action === 'change_plan') {
      if (!canChangePlan(subscription.status, subscription.cancel_at_period_end)) {
        throw new BillingError(409, subscription.status === 'trialing' ? 'You cannot change plans during your trial.' : 'Plan changes require an active, non-canceling subscription.');
      }
      if (!plan) throw new BillingError(400, 'Choose a valid plan.');
      if (subscription.schedule || subscription.pending_update) throw new BillingError(409, 'A subscription change is already scheduled.');
      if (subscription.automatic_tax.enabled || subscription.discounts.length || subscription.default_tax_rates?.length) {
        throw new BillingError(409, 'This subscription requires a reviewed plan change.');
      }
      const item = subscription.items.data[0];
      const nextPrice = await resolvePrice(stripe, plan);
      if (item.price.id === nextPrice.id) throw new BillingError(409, 'You are already on this plan.');
      if (item.current_period_end <= Math.floor(Date.now() / 1000)) throw new BillingError(409, 'Renewal is processing; retry after it completes.');
      const invoiceId = resourceId(subscription.latest_invoice);
      if (!invoiceId || (await stripe.invoices.retrieve(invoiceId)).status !== 'paid') throw new BillingError(409, 'Settle the current invoice before changing plans.');
      writeStarted = true;
      const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id }, { idempotencyKey: `${operationId}-schedule` });
      if (!schedule.current_phase) throw new Error('Missing current schedule phase.');
      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release', proration_behavior: 'none',
        metadata: { rekodja_user_id: userId, operation_id: operationId },
        phases: [
          { start_date: schedule.current_phase.start_date, end_date: item.current_period_end,
            items: [{ price: item.price.id, quantity: 1 }], proration_behavior: 'none' },
          { start_date: item.current_period_end, duration: { interval: PLANS[plan].interval, interval_count: PLANS[plan].count },
            items: [{ price: nextPrice.id, quantity: 1 }], billing_cycle_anchor: 'phase_start', proration_behavior: 'none' },
        ],
      }, { idempotencyKey: `${operationId}-phases` });
      completed = true;
      return { message: 'Plan change scheduled for your next renewal. No charge was made now.', effectiveAt: new Date(item.current_period_end * 1000).toISOString() };
    }
    if (!['trialing', 'active', 'past_due'].includes(subscription.status)) throw new BillingError(409, 'This subscription cannot be canceled here.');
    if (subscription.cancel_at_period_end) return { message: 'Cancellation is already scheduled.' };
    if (subscription.schedule) {
      const schedule = await stripe.subscriptionSchedules.retrieve(resourceId(subscription.schedule)!);
      if (schedule.metadata?.rekodja_user_id !== userId) throw new BillingError(409, 'This schedule requires support to cancel safely.');
      writeStarted = true;
      await stripe.subscriptionSchedules.release(schedule.id, { preserve_cancel_date: true }, { idempotencyKey: `${operationId}-release` });
    }
    writeStarted = true;
    await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true, proration_behavior: 'none' }, { idempotencyKey: `${operationId}-cancel` });
    completed = true;
    return { message: subscription.status === 'trialing' ? 'Trial canceled. Pro remains available until the trial ends; no subscription charge will be made.' : 'Cancellation scheduled at the end of your current billing period.' };
  } finally {
    // Never auto-expire an uncertain Stripe mutation lock: that could allow a
    // conflicting write after a network timeout. Reconcile provider state first.
    if (!writeStarted || completed) {
      const { error } = await admin.from('billing_customers').update({ mutation_id: null, mutation_kind: null, mutation_started_at: null })
        .eq('user_id', userId).eq('mutation_id', operationId);
      if (error) throw new Error('Billing operation needs reconciliation.');
    }
  }
}
