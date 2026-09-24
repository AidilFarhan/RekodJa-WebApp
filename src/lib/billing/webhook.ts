import 'server-only';
import type Stripe from 'stripe';
import { supabaseAdmin } from '../supabase-admin';
import { verifiedStripe } from '../stripe/server';
import { eventSubscriptionId, failureWindowStart, resourceId, subscriptionSnapshot } from './stripe-state';

async function firstFailedAt(stripe: Stripe, sub: Stripe.Subscription): Promise<string> {
  const invoiceId = resourceId(sub.latest_invoice);
  if (!invoiceId) throw new Error('Missing failed invoice.');
  const invoice = await stripe.invoices.retrieve(invoiceId);
  let earliest: number | null = null;
  let inspected = 0;
  const windowStart = failureWindowStart(invoice.created, Math.floor(Date.now() / 1000));
  // Stripe retains Events for 30 days. If evidence is unavailable, retry/fail
  // closed rather than silently grant a new seven-day grace period.
  for await (const event of stripe.events.list({ type: 'invoice.payment_failed', created: { gte: windowStart }, limit: 100 })) {
    if (++inspected > 1000) throw new Error('Failure history requires reconciliation.');
    if ((event.data.object as Stripe.Invoice).id === invoiceId) {
      earliest = earliest === null ? event.created : Math.min(earliest, event.created);
    }
  }
  if (earliest === null) throw new Error('First failure event is not available yet.');
  return new Date(earliest * 1000).toISOString();
}

export async function processBillingEvent(event: Stripe.Event) {
  if (event.livemode) throw new Error('Live events are not accepted.');
  const subscriptionId = eventSubscriptionId(event);
  if (!subscriptionId) return 'ignored';
  const stripe = await verifiedStripe();
  const admin = supabaseAdmin();
  const target = await stripe.subscriptions.retrieve(subscriptionId);
  const customerId = resourceId(target.customer);
  if (!customerId) throw new Error('Missing subscription customer.');
  for (let attempt = 0; attempt < 4; attempt++) {
    // Read the revision BEFORE fetching Stripe. A concurrent webhook forces a
    // new Stripe retrieval, not a replay of a stale subscription snapshot.
    const { data: owner, error: ownerError } = await admin.from('billing_customers')
      .select('user_id,subscription_revision').eq('stripe_customer_id', customerId).maybeSingle();
    if (ownerError) throw new Error('Could not resolve billing ownership.');
    if (!owner) return 'unmanaged';
    const { data: previous, error: previousError } = await admin.from('subscriptions')
      .select('stripe_subscription_id,status,past_due_at').eq('user_id', owner.user_id).maybeSingle();
    if (previousError) throw new Error('Could not read subscription state.');
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    if (current.livemode || resourceId(current.customer) !== customerId) throw new Error('Invalid subscription owner.');
    if (previous?.stripe_subscription_id && previous.stripe_subscription_id !== current.id) {
      const stored = await stripe.subscriptions.retrieve(previous.stripe_subscription_id);
      if (stored.created >= current.created) return 'superseded';
    }
    const failure = current.status !== 'past_due' ? null :
      previous?.status === 'past_due' && previous.stripe_subscription_id === current.id && previous.past_due_at
        ? previous.past_due_at as string : await firstFailedAt(stripe, current);
    const { data: result, error } = await admin.rpc('apply_stripe_subscription_event', {
      p_event_id: event.id, p_event_type: event.type,
      p_stripe_created_at: new Date(event.created * 1000).toISOString(),
      p_expected_revision: owner.subscription_revision,
      p_subscription: subscriptionSnapshot(current, owner.user_id, failure),
    });
    if (error) throw new Error('Subscription transaction failed.');
    if (result === 'applied' || result === 'duplicate') return result;
    if (result !== 'retry') throw new Error('Unexpected transaction result.');
  }
  throw new Error('Subscription is busy; retry webhook delivery.');
}
