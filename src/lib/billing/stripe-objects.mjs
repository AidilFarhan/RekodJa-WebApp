// Mode-specific Stripe objects.
//
// A price, product or portal configuration created in test mode does not exist
// in live mode. Anything that differs between the two modes therefore comes
// from the environment, with the Sandbox value as the test default.
//
// In live mode a missing value returns null rather than falling back to the
// Sandbox id, so the caller fails with a clear error instead of handing a test
// object to the live account.
import { SANDBOX_CARDS_CONFIG_NAME, SANDBOX_PORTAL, SANDBOX_PRODUCT } from './plans.ts';
import { billingEnvironment, billingEnvironmentWithKey } from './test-environment.mjs';

const SANDBOX_DEFAULTS = {
  STRIPE_PORTAL_CONFIGURATION: SANDBOX_PORTAL,
  STRIPE_PRODUCT: SANDBOX_PRODUCT,
  STRIPE_CARDS_CONFIG_NAME: SANDBOX_CARDS_CONFIG_NAME,
};

/** The configured value for a mode-specific Stripe object, or null when there
 * is none for this environment.
 * @param {Record<string, string | undefined>} env
 * @param {'STRIPE_PORTAL_CONFIGURATION' | 'STRIPE_PRODUCT' | 'STRIPE_CARDS_CONFIG_NAME'} name
 * @returns {string | null}
 */
export function stripeObject(env, name) {
  const configured = env[name];
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return billingEnvironment(env) === 'test' ? SANDBOX_DEFAULTS[name] : null;
}

/** Whether this process is the live one. False in the Test project, and false
 * when no key is configured, so a test run never accepts live objects.
 * @param {Record<string, string | undefined>} env
 */
export function liveMode(env) {
  return billingEnvironmentWithKey(env) === 'live';
}
