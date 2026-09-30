import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isBetaTester } from './beta';
import { betaConfiguration } from './beta-server';
import { getBillingCustomer } from './checkout';
import type { BillingView } from './presentation';
import { billingTestEnabled, readSubscription } from './server';

/** The deadline is defined in Malaysia time, so format it there. Otherwise a
 * server in another timezone could show the card ending a day early or late.
 */
function formatBetaEnd(endsAtMs: number): string {
  return new Intl.DateTimeFormat('ms', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(endsAtMs));
}

/** Plan-card state for the signed-in user, or null when there is nothing to
 * show them. `user` must be the object Supabase Auth returned, so the beta list
 * is matched against the verified email rather than a request-supplied value.
 */
export async function billingView(
  client: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<BillingView | null> {
  const { emails, endsAtMs } = betaConfiguration();
  const betaEligible = isBetaTester(user.email, emails, endsAtMs, Date.now());
  const subscription = await readSubscription(client, user.id);

  // Outside the test rollout the card stays hidden for everyone except a beta
  // tester or a real subscriber, so an ordinary production user keeps seeing
  // the previous "not available yet" copy. That is a deliberate no-change.
  if (!billingTestEnabled() && !betaEligible && !subscription) return null;

  let hasBillingAccount = false;
  try {
    // billing_customers is service-role only, so this cannot be read with the
    // user's client. A missing server credential must degrade the card, not
    // break the whole Settings page: every action still fails closed.
    hasBillingAccount = Boolean((await getBillingCustomer(user.id)).stripe_customer_id);
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
    betaEndsLabel: betaEligible && endsAtMs !== null ? formatBetaEnd(endsAtMs) : null,
  };
}
