/** Evaluate a subscription loaded for the authenticated user by the server.
 * Client-provided subscription data must never authorize server access.
 */
export type ProSubscription = {
  status: string;
  trial_end: string | null;
  current_period_end: string | null;
  past_due_at: string | null;
  cancel_at_period_end: boolean;
};

export const PRO_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export function isPro(subscription: ProSubscription | null | undefined, now = Date.now()): boolean {
  if (!subscription || !Number.isFinite(now)) return false;
  const deadline = (value: string | null) => value ? Date.parse(value) : NaN;
  if (subscription.status === 'trialing') return now < deadline(subscription.trial_end);
  // Do not extend access past a stored paid period if a webhook is delayed.
  if (subscription.status === 'active') return now < deadline(subscription.current_period_end);
  if (subscription.status === 'past_due') {
    const started = deadline(subscription.past_due_at);
    return Number.isFinite(started) && started <= now && now < started + PRO_GRACE_MS;
  }
  return false;
}
