import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBillingCustomer } from './checkout';
import type { BillingView } from './presentation';
import { billingTestEnabled, readSubscription } from './server';

/** Plan-card state for the signed-in user, or null when the Sandbox rollout is
 * not active for this deployment. */
export async function billingView(client: SupabaseClient, userId: string): Promise<BillingView | null> {
  if (!billingTestEnabled()) return null;
  const subscription = await readSubscription(client, userId);
  let hasBillingAccount = false;
  try {
    // billing_customers is service-role only, so this cannot be read with the
    // user's client. A missing server credential must degrade the card, not
    // break the whole Settings page: every action still fails closed.
    hasBillingAccount = Boolean((await getBillingCustomer(userId)).stripe_customer_id);
  } catch {
    hasBillingAccount = false;
  }
  return {
    status: subscription?.status ?? null,
    planKey: subscription?.price_lookup_key ?? null,
    trialEnd: subscription?.trial_end ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    hasUsedTrial: subscription?.has_used_trial ?? false,
    hasBillingAccount,
  };
}
