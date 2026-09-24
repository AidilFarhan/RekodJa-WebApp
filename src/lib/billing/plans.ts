export const PLANS = {
  PRO_monthly: { label: 'Monthly', amount: 600, interval: 'month', count: 1 },
  PRO_3_months: { label: '3 months', amount: 1800, interval: 'month', count: 3 },
  PRO_yearly: { label: 'Yearly', amount: 6600, interval: 'year', count: 1 },
} as const;
export type PlanKey = keyof typeof PLANS;
export const TRIAL_DAYS = 14;
export const SANDBOX_ACCOUNT = 'acct_1UJBHNIz7rRwXn6f';
export const SANDBOX_PORTAL = 'bpc_1UJHEgIz7rRwXn6fkqSWAKnT';
export const SANDBOX_PRODUCT = 'prod_VJp91FLk0SMjRJ';
export const PRO_REQUIRED_MESSAGE = "You haven't subscribed to Pro yet, please subscribe to use this feature";
export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}
export function canChangePlan(status: string, cancelAtPeriodEnd: boolean) {
  return status === 'active' && !cancelAtPeriodEnd;
}
export function isTerminalSubscription(status: string) {
  return status === 'canceled' || status === 'incomplete_expired';
}
