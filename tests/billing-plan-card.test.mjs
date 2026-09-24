import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelPrompt,
  defaultPlan,
  planCard,
  planChoices,
  planFacts,
  planIntervalLabel,
  planPriceLabel,
  PLAN_NOTES,
  stateSlug,
  subscriptionRequest,
  subscriptionState,
} from '../src/lib/billing/presentation.ts';

const now = '2026-09-24T12:00:00.000Z';
const label = (value) => `DATE(${value.slice(0, 10)})`;

function view(overrides = {}) {
  return {
    status: null,
    planKey: null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasUsedTrial: false,
    hasBillingAccount: false,
    ...overrides,
  };
}

test('every non-entitled Stripe status collapses to a closed label', () => {
  assert.equal(subscriptionState(null), 'Free');
  assert.equal(subscriptionState('trialing'), 'Trial');
  assert.equal(subscriptionState('active'), 'Active');
  assert.equal(subscriptionState('past_due'), 'Past due');
  // canceled, unpaid, paused, incomplete and incomplete_expired all deny access.
  for (const status of ['canceled', 'unpaid', 'paused', 'incomplete', 'incomplete_expired']) {
    assert.equal(subscriptionState(status), 'Canceled');
  }
  assert.deepEqual(
    [subscriptionState('trialing'), subscriptionState('active'), subscriptionState('past_due'), subscriptionState('canceled'), subscriptionState(null)].map(stateSlug),
    ['trial', 'active', 'past-due', 'canceled', 'free'],
  );
});

test('plan prices and intervals come from the plan table, never from request input', () => {
  assert.equal(planPriceLabel('PRO_monthly'), 'RM6 monthly');
  assert.equal(planPriceLabel('PRO_3_months'), 'RM18 every 3 months');
  assert.equal(planPriceLabel('PRO_yearly'), 'RM66 yearly');
  assert.equal(planIntervalLabel('PRO_3_months'), '3 months');
  for (const value of [null, '', 'PRO_weekly', 'price_1UJBVAIz7rRwXn6fWnRnOyp2', 'PRO_MONTHLY']) {
    assert.equal(planPriceLabel(value), null);
    assert.equal(planIntervalLabel(value), null);
  }
});

test('basic checkout and current-period dates render as given', () => {
  const card = planCard(view(), label);
  assert.equal(card.state, 'Free');
  assert.equal(card.planPrice, null);
  assert.equal(card.trialEnd, null);
  assert.equal(card.nextBilling, null);
  assert.equal(card.canSubscribe, true);
  assert.equal(card.canManage, false);
  assert.equal(card.canCancel, false);
  assert.equal(card.canChangePlan, false);

  assert.equal(planCard(view({ currentPeriodEnd: now }), label).nextBilling, `DATE(2026-09-24)`);
});

test('a trial offers cancellation but never plan switching or a second Checkout', () => {
  const trial = planCard(view({
    status: 'trialing', planKey: 'PRO_monthly', trialEnd: now, currentPeriodEnd: now, hasUsedTrial: true, hasBillingAccount: true,
  }), label);
  assert.equal(trial.state, 'Trial');
  assert.equal(trial.planPrice, 'RM6 monthly');
  assert.equal(trial.interval, 'Monthly');
  assert.equal(trial.trialEnd, 'DATE(2026-09-24)');
  assert.equal(trial.canChangePlan, false);
  assert.equal(trial.canCancel, true);
  assert.equal(trial.canSubscribe, false);
  assert.equal(trial.canManage, true);
  // The chooser only lists plans other than the current one, and only when the
  // server would accept the change.
  assert.deepEqual(planChoices(trial), ['PRO_monthly', 'PRO_3_months', 'PRO_yearly']);
  assert.equal(defaultPlan(trial), 'PRO_monthly');
});

test('an active subscription can change plan, but a scheduled cancellation blocks it', () => {
  const active = view({ status: 'active', planKey: 'PRO_3_months', currentPeriodEnd: now, hasUsedTrial: true, hasBillingAccount: true });
  const card = planCard(active, label);
  assert.equal(card.state, 'Active');
  assert.equal(card.canChangePlan, true);
  assert.equal(card.canCancel, true);
  assert.equal(card.canSubscribe, false);
  assert.deepEqual(planChoices(card), ['PRO_monthly', 'PRO_yearly']);
  assert.equal(defaultPlan(card), 'PRO_monthly');

  const canceling = planCard({ ...active, cancelAtPeriodEnd: true }, label);
  assert.equal(canceling.canChangePlan, false);
  assert.equal(canceling.canCancel, false);
  assert.equal(canceling.cancelAtPeriodEnd, true);
  assert.equal(canceling.nextBilling, 'DATE(2026-09-24)');
});

test('past due keeps support actions but never opens a new subscription', () => {
  const card = planCard(view({ status: 'past_due', planKey: 'PRO_yearly', currentPeriodEnd: now, hasUsedTrial: true, hasBillingAccount: true }), label);
  assert.equal(card.state, 'Past due');
  assert.equal(card.canSubscribe, false);
  assert.equal(card.canCancel, true);
  assert.equal(card.canChangePlan, false);
  assert.equal(card.canManage, true);
});

test('a finished subscription can start Checkout again and reach the portal', () => {
  const card = planCard(view({ status: 'canceled', planKey: 'PRO_monthly', hasUsedTrial: true, hasBillingAccount: true }), label);
  assert.equal(card.state, 'Canceled');
  assert.equal(card.planPrice, 'RM6 monthly');
  assert.equal(card.canSubscribe, true);
  assert.equal(card.canManage, true);
  assert.equal(card.canCancel, false);
  assert.equal(card.canChangePlan, false);
  assert.equal(card.usedTrial, true);
});

test('an unknown plan key never reaches the UI as a price', () => {
  const card = planCard(view({ status: 'active', planKey: 'PRO_lifetime', currentPeriodEnd: now, hasBillingAccount: true }), label);
  assert.equal(card.planPrice, null);
  assert.equal(card.interval, null);
  assert.equal(card.currentPlanKey, 'PRO_lifetime');
});

test('subscription requests accept only the two allow-listed actions', () => {
  assert.deepEqual(subscriptionRequest({ action: 'cancel' }), { action: 'cancel' });
  assert.deepEqual(subscriptionRequest({ action: 'change_plan', plan: 'PRO_yearly' }), { action: 'change_plan', plan: 'PRO_yearly' });
  for (const body of [
    null, undefined, 'cancel', 42, [], {},
    { action: 'cancel', plan: 'PRO_yearly', priceId: 'price_1UJBVAIz7rRwXn6fWnRnOyp2' },
    { action: 'change_plan' },
    { action: 'change_plan', plan: 'PRO_lifetime' },
    { action: 'change_plan', plan: null },
    { action: 'delete' },
    { action: 'CHANGE_PLAN', plan: 'PRO_yearly' },
  ]) {
    const parsed = subscriptionRequest(body);
    if (body && typeof body === 'object' && body.action === 'cancel') {
      // A cancel request ignores every other field and carries no plan forward.
      assert.deepEqual(parsed, { action: 'cancel' });
    } else {
      assert.equal(parsed, null);
    }
  }
});

test('a view without billing keeps every action closed', () => {
  const card = planCard(view({ hasUsedTrial: true }), label);
  assert.equal(card.state, 'Free');
  assert.equal(card.canManage, false);
  assert.equal(card.usedTrial, true);
  assert.equal(card.trialEnd, null);
  assert.equal(card.nextBilling, null);
});

test('the Plan card states every required term', () => {
  assert.deepEqual(PLAN_NOTES, [
    '14-day trial for first subscription only',
    'Card required during trial',
    'Cancel during trial: access remains until trial end, no charge',
    'Past due grace period: 7 days',
    'Plan changes take effect on next renewal',
  ]);
});

test('fact rows carry the required labels and never show a missing date', () => {
  assert.deepEqual(planFacts(planCard(view(), label)), []);

  const trial = planCard(view({ status: 'trialing', planKey: 'PRO_monthly', trialEnd: now, currentPeriodEnd: now, hasBillingAccount: true }), label);
  assert.deepEqual(planFacts(trial), [
    ['Current plan', 'RM6 monthly'],
    ['Current billing interval', 'Monthly'],
    ['Trial end date', 'DATE(2026-09-24)'],
    ['Next billing date', 'DATE(2026-09-24)'],
  ]);

  // Once cancellation is scheduled the period end is an end of access, not a
  // date the user will be billed on.
  const canceling = planCard(view({ status: 'active', planKey: 'PRO_yearly', currentPeriodEnd: now, cancelAtPeriodEnd: true, hasBillingAccount: true }), label);
  assert.deepEqual(planFacts(canceling), [
    ['Current plan', 'RM66 yearly'],
    ['Current billing interval', 'Yearly'],
    ['Access until', 'DATE(2026-09-24)'],
  ]);
});

test('cancelling a trial promises no charge; cancelling a paid plan promises no refund', () => {
  const trial = cancelPrompt(planCard(view({ status: 'trialing', trialEnd: now }), label));
  assert.equal(trial.label, 'Cancel trial');
  assert.match(trial.body, /until DATE\(2026-09-24\)/);
  assert.match(trial.body, /not be charged when the trial ends/);

  const active = cancelPrompt(planCard(view({ status: 'active', currentPeriodEnd: now }), label));
  assert.equal(active.label, 'Cancel subscription');
  assert.match(active.body, /until DATE\(2026-09-24\)/);
  assert.match(active.body, /Nothing is refunded/);

  // A past-due subscription with no stored period still gets a readable prompt.
  const empty = cancelPrompt(planCard(view({ status: 'past_due' }), label));
  assert.match(empty.body, /the current period ends/);
});
