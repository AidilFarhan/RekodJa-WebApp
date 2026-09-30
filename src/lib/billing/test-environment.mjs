// Public environment identifiers only. Never return credential values in errors.
export const TEST_SUPABASE_URL = 'https://zfcxgfiqmirkqerqzsny.supabase.co';
export const TEST_PROJECT_REF = 'zfcxgfiqmirkqerqzsny';
export const TEST_APP_URL = 'http://localhost:3002';

/** This checks legacy key claims, NOT its cryptographic validity. Supabase
 * authenticates the credential when it is used. Opaque keys cannot prove a
 * project match offline, so admin access currently requires the legacy key.
 * @param {string | undefined} key
 * @param {'anon' | 'service_role'} role
 */
export function isTestLegacyKey(key, role) {
  try {
    const parts = (key ?? '').split('.');
    if (parts.length !== 3 || parts.some(part => !part)) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === role && payload.ref === TEST_PROJECT_REF;
  } catch {
    return false;
  }
}

/** @param {Record<string, string | undefined>} env */
export function assertTestEnvironment(env) {
  if (env.SUPABASE_URL !== TEST_SUPABASE_URL || env.APP_URL !== TEST_APP_URL) {
    throw new Error('Billing requires the isolated RekodJa Test environment.');
  }
}

/** The one production origin allowed to run billing. A preview deployment or a
 * local checkout presents a different origin and is refused.
 */
export const LIVE_APP_URL = 'https://app.rekodja.com';

/** The Sandbox account. A Stripe Sandbox is an account of its own, with its own
 * id, so this is NOT the same as the live account below.
 */
export const SANDBOX_ACCOUNT = 'acct_1UJBHNIz7rRwXn6f';

/** The live account for this product. */
export const LIVE_ACCOUNT = 'acct_1UJBFEEcRxlOqjok';

/** The account an environment must belong to, or null when it cannot be
 * determined.
 *
 * Pinning per environment is what stops a key from another Stripe account
 * being used: a key prefix does not identify an account, and a live key does
 * not belong to the Sandbox account.
 * @param {Record<string, string | undefined>} env
 */
export function accountFor(env) {
  const environment = billingEnvironment(env);
  if (environment === 'test') return SANDBOX_ACCOUNT;
  if (environment === 'live') return LIVE_ACCOUNT;
  return null;
}

/** Which environment this process is, or null when it is neither the isolated
 * Test project nor the production app. Billing refuses anything unrecognised,
 * so a preview deployment cannot reach Stripe by accident.
 * @param {Record<string, string | undefined>} env
 * @returns {'test' | 'live' | null}
 */
export function billingEnvironment(env) {
  if (env.SUPABASE_URL === TEST_SUPABASE_URL && env.APP_URL === TEST_APP_URL) return 'test';
  if (env.APP_URL === LIVE_APP_URL && env.SUPABASE_URL && env.SUPABASE_URL !== TEST_SUPABASE_URL) {
    // A development server is never live, however it is configured. A live key
    // sitting in a local env file beside the production APP_URL would otherwise
    // make `npm run dev` able to charge real customers. A deployment sets
    // NODE_ENV=production; `npm run dev` does not.
    if (env.NODE_ENV === 'development') return null;
    return 'live';
  }
  return null;
}

/** The app origin for an environment. Stripe return URLs must point at the
 * environment the customer is actually in, or they land somewhere they cannot
 * sign in to.
 * @param {Record<string, string | undefined>} env
 */
export function currentAppUrl(env) {
  const environment = billingEnvironment(env);
  if (environment === 'test') return TEST_APP_URL;
  if (environment === 'live') return LIVE_APP_URL;
  throw new Error('Billing requires a recognised environment.');
}

/** Which mode a Stripe key belongs to, or null when it is not a key this app
 * may use.
 *
 * Restricted keys (`rk_`) are accepted as well as secret keys (`sk_`). A
 * restricted key is the least-privilege option and is the better choice where
 * the account grants only the billing permissions this app needs. A
 * publishable key (`pk_`) is never a credential and is refused.
 * @param {string | undefined} key
 * @returns {'test' | 'live' | null}
 */
export function stripeKeyMode(key) {
  if (typeof key !== 'string') return null;
  // Environment values are pasted by hand and often carry a trailing newline or
  // space. Trimming here prevents a key that looks correct everywhere else from
  // failing for a reason nobody can see.
  const value = key.trim();
  if (value.startsWith('sk_test_') || value.startsWith('rk_test_')) return 'test';
  if (value.startsWith('sk_live_') || value.startsWith('rk_live_')) return 'live';
  return null;
}

/** The environment, but only when its secret key belongs to that same mode.
 *
 * A live key on a developer machine could charge real customers, and a test key
 * in production would create subscriptions Stripe never bills. A mismatch is
 * therefore treated as no environment at all, which fails closed.
 * @param {Record<string, string | undefined>} env
 * @returns {'test' | 'live' | null}
 */
export function billingEnvironmentWithKey(env) {
  const environment = billingEnvironment(env);
  if (!environment) return null;
  return stripeKeyMode(env.STRIPE_SECRET_KEY) === environment ? environment : null;
}
