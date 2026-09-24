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

/** Which environment this process is, or null when it is neither the isolated
 * Test project nor the production app. Billing refuses anything unrecognised,
 * so a preview deployment cannot reach Stripe by accident.
 * @param {Record<string, string | undefined>} env
 * @returns {'test' | 'live' | null}
 */
export function billingEnvironment(env) {
  if (env.SUPABASE_URL === TEST_SUPABASE_URL && env.APP_URL === TEST_APP_URL) return 'test';
  if (env.APP_URL === LIVE_APP_URL && env.SUPABASE_URL && env.SUPABASE_URL !== TEST_SUPABASE_URL) {
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

/** Which mode a Stripe secret key belongs to, or null when it is not a Stripe
 * secret key at all.
 * @param {string | undefined} key
 * @returns {'test' | 'live' | null}
 */
export function stripeKeyMode(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
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
