// Explicit .ts extension: node --test loads this module from tests directly,
// without a bundler to resolve extensionless specifiers.
import { canChangePlan, isPlanKey, PLANS, type PlanKey } from './plans.ts';

/** Raw billing state for one user, or null when the Sandbox rollout is off. */
export type BillingView = {
  status: string | null;
  planKey: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasUsedTrial: boolean;
  hasBillingAccount: boolean;
  /** Preformatted date the free beta access ends, or null when this user is
   * not a beta tester. Already formatted so server and client cannot disagree
   * about the timezone.
   */
  betaEndsLabel: string | null;
};

/** Closed vocabulary for the Plan card. Every Stripe status without Pro access
 * is reported as Canceled so the card never leaks raw provider values. Beta is
 * shown only when there is no subscription to describe.
 */
export type BillingState = 'Free' | 'Beta' | 'Trial' | 'Active' | 'Past due' | 'Canceled';

export function subscriptionState(status: string | null, betaEligible = false): BillingState {
  if (status === 'trialing') return 'Trial';
  if (status === 'active') return 'Active';
  if (status === 'past_due') return 'Past due';
  if (status) return 'Canceled';
  return betaEligible ? 'Beta' : 'Free';
}

export function stateSlug(state: BillingState): string {
  return state.toLowerCase().replace(' ', '-');
}

export function planPriceLabel(key: string | null): string | null {
  if (!isPlanKey(key)) return null;
  const plan = PLANS[key];
  const ringgit = `RM${plan.amount / 100}`;
  if (plan.interval === 'year') return `${ringgit} yearly`;
  return plan.count === 1 ? `${ringgit} monthly` : `${ringgit} every ${plan.count} months`;
}

export function planIntervalLabel(key: string | null): string | null {
  if (!isPlanKey(key)) return null;
  return PLANS[key].label;
}

/** Everything the Plan card renders. Dates are preformatted by the caller so
 * the server and the client can never disagree on a timezone. */
export type PlanCard = {
  state: BillingState;
  slug: string;
  planPrice: string | null;
  interval: string | null;
  trialEnd: string | null;
  nextBilling: string | null;
  cancelAtPeriodEnd: boolean;
  usedTrial: boolean;
  canSubscribe: boolean;
  canManage: boolean;
  canCancel: boolean;
  canChangePlan: boolean;
  currentPlanKey: string | null;
  betaEnds: string | null;
};

export function planCard(view: BillingView, formatDate: (value: string) => string): PlanCard {
  const betaEligible = Boolean(view.betaEndsLabel);
  const state = subscriptionState(view.status, betaEligible);
  const running = ['trialing', 'active', 'past_due'].includes(view.status ?? '');
  return {
    state,
    slug: stateSlug(state),
    planPrice: planPriceLabel(view.planKey),
    interval: planIntervalLabel(view.planKey),
    trialEnd: state === 'Trial' && view.trialEnd ? formatDate(view.trialEnd) : null,
    nextBilling: view.currentPeriodEnd ? formatDate(view.currentPeriodEnd) : null,
    cancelAtPeriodEnd: view.cancelAtPeriodEnd,
    usedTrial: view.hasUsedTrial,
    // Opening Checkout while a subscription runs is rejected server-side, so the
    // button is only offered for a clean slate.
    canSubscribe: !running,
    canManage: running || view.hasBillingAccount,
    canCancel: running && !view.cancelAtPeriodEnd,
    // Plan switching is blocked during a trial and after a cancellation is
    // scheduled, matching the server rule in manageSubscription.
    canChangePlan: canChangePlan(view.status ?? '', view.cancelAtPeriodEnd),
    currentPlanKey: view.planKey,
    betaEnds: state === 'Beta' ? view.betaEndsLabel : null,
  };
}

/** Plans a user can pick right now: every plan for a first subscription, or
 * every plan except the current one when switching. */
export function planChoices(card: PlanCard): PlanKey[] {
  const keys = Object.keys(PLANS) as PlanKey[];
  return card.canChangePlan && isPlanKey(card.currentPlanKey)
    ? keys.filter((key) => key !== card.currentPlanKey)
    : keys;
}

export function defaultPlan(card: PlanCard): PlanKey {
  return planChoices(card)[0];
}

/** Rows of the Plan card. A date only appears once it exists, so a Free card
 * never shows an empty "Trial end date". */
export function planFacts(card: PlanCard): [string, string][] {
  const facts: [string, string][] = [];
  if (card.planPrice) facts.push(['Current plan', card.planPrice]);
  if (card.interval) facts.push(['Current billing interval', card.interval]);
  if (card.trialEnd) facts.push(['Trial end date', card.trialEnd]);
  if (card.nextBilling) facts.push([card.cancelAtPeriodEnd ? 'Access until' : 'Next billing date', card.nextBilling]);
  return facts;
}

/** Wording shown before a cancellation is confirmed. A trial cancellation must
 * promise that no charge follows. */
export function cancelPrompt(card: PlanCard): { label: string; body: string } {
  const label = card.state === 'Trial' ? 'Cancel trial' : 'Cancel subscription';
  const end = card.trialEnd ?? card.nextBilling;
  return {
    label,
    body: card.state === 'Trial'
      ? `Pro stays available until ${end ?? 'the trial ends'}. You will not be charged when the trial ends.`
      : `Pro stays available until ${end ?? 'the current period ends'}. Nothing is refunded and no further charge is made.`,
  };
}

/** Standing terms shown on the Plan card in every state. */
export const PLAN_NOTES = [
  '14-day trial for first subscription only',
  'Card required during trial',
  'Cancel during trial: access remains until trial end, no charge',
  'Past due grace period: 7 days',
  'Plan changes take effect on next renewal',
];

export type SubscriptionRequest =
  | { action: 'cancel' }
  | { action: 'change_plan'; plan: PlanKey };

/** Parsed body for POST /api/billing/subscription. Returns null for anything
 * outside the two allow-listed actions, so the route answers 400 rather than
 * forwarding an unvalidated plan to Stripe. */
export function subscriptionRequest(body: unknown): SubscriptionRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { action, plan } = body as { action?: unknown; plan?: unknown };
  if (action === 'cancel') return { action };
  if (action === 'change_plan' && isPlanKey(plan)) return { action, plan };
  return null;
}
