import type Stripe from 'stripe';
import { isPlanKey, PLANS, SANDBOX_PRODUCT } from './plans.ts';

export function resourceId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null;
}
/** Lower bound for looking up an invoice's first failure event.
 * Stripe shifts invoice timestamps onto a test clock but leaves Event.created on
 * the real clock, so anchoring only on invoice.created finds nothing while a
 * clock runs ahead of real time. The extra day cannot widen a result: matches
 * are still keyed on the invoice id, and the earliest match wins.
 */
export function failureWindowStart(invoiceCreated: number, nowSeconds: number): number {
  return Math.min(invoiceCreated, nowSeconds) - 86_400;
}
export function validatePrice(price: Stripe.Price, requireActive = false) {
  if (!isPlanKey(price.lookup_key)) throw new Error('Unsupported billing plan.');
  const plan = PLANS[price.lookup_key];
  if (price.livemode || (requireActive && !price.active) || price.currency !== 'myr' ||
      price.unit_amount !== plan.amount || price.recurring?.interval !== plan.interval ||
      price.recurring.interval_count !== plan.count || price.recurring.usage_type !== 'licensed' ||
      resourceId(price.product) !== SANDBOX_PRODUCT) throw new Error('Unexpected Sandbox price configuration.');
  return price.lookup_key;
}
export function subscriptionSnapshot(sub: Stripe.Subscription, userId: string, firstFailure: string | null) {
  if (sub.livemode || sub.items.data.length !== 1 || sub.items.has_more || sub.items.data[0].quantity !== 1) {
    throw new Error('Unsupported subscription configuration.');
  }
  const item = sub.items.data[0];
  const key = validatePrice(item.price);
  const iso = (seconds: number | null) => seconds === null ? null : new Date(seconds * 1000).toISOString();
  return {
    user_id: userId, stripe_customer_id: resourceId(sub.customer), stripe_subscription_id: sub.id,
    status: sub.status, price_id: item.price.id, price_lookup_key: key,
    billing_interval: PLANS[key].interval, billing_interval_count: PLANS[key].count,
    trial_end: iso(sub.trial_end), current_period_end: iso(item.current_period_end),
    past_due_at: sub.status === 'past_due' ? firstFailure : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    has_used_trial: sub.trial_start !== null || sub.trial_end !== null,
  };
}
export function eventSubscriptionId(event: Stripe.Event): string | null {
  if (event.type.startsWith('customer.subscription.')) return (event.data.object as Stripe.Subscription).id;
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    return resourceId(invoice.parent?.subscription_details?.subscription);
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    return resourceId((event.data.object as Stripe.Checkout.Session).subscription);
  }
  return null;
}
