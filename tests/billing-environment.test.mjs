import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_APP_URL,
  TEST_APP_URL,
  TEST_SUPABASE_URL,
  accountFor,
  billingEnvironment,
  billingEnvironmentWithKey,
  currentAppUrl,
  stripeKeyMode,
} from '../src/lib/billing/test-environment.mjs';
import { SANDBOX_CARDS_CONFIG_NAME } from '../src/lib/billing/plans.ts';
import { stripeObject } from '../src/lib/billing/stripe-objects.mjs';

const TEST_ENV = {
  SUPABASE_URL: TEST_SUPABASE_URL,
  APP_URL: TEST_APP_URL,
  STRIPE_SECRET_KEY: 'sk_test_example',
};
const LIVE_ENV = {
  SUPABASE_URL: 'https://production-project.supabase.co',
  APP_URL: LIVE_APP_URL,
  STRIPE_SECRET_KEY: 'sk_live_example',
};

test('the Test project is recognised only with the exact local origin', () => {
  assert.equal(billingEnvironment(TEST_ENV), 'test');
  assert.equal(billingEnvironment({ ...TEST_ENV, APP_URL: LIVE_APP_URL }), null);
});

test('the production origin is recognised, but not with the Test project', () => {
  assert.equal(billingEnvironment(LIVE_ENV), 'live');
  assert.equal(billingEnvironment({ ...LIVE_ENV, SUPABASE_URL: TEST_SUPABASE_URL }), null);
});

test('an unrecognised deployment is refused', () => {
  // A preview deployment has its own host and must not be able to reach Stripe.
  assert.equal(billingEnvironment({ ...LIVE_ENV, APP_URL: 'https://rekodja-git-branch.vercel.app' }), null);
  assert.equal(billingEnvironment({}), null);
});

test('only key prefixes that are a secret or a restricted key are recognised', () => {
  assert.equal(stripeKeyMode('sk_test_example'), 'test');
  assert.equal(stripeKeyMode('sk_live_example'), 'live');
  // Restricted keys are the least-privilege option, so they are accepted too.
  assert.equal(stripeKeyMode('rk_test_example'), 'test');
  assert.equal(stripeKeyMode('rk_live_example'), 'live');
  // A publishable key is never a credential.
  assert.equal(stripeKeyMode('pk_live_example'), null);
  assert.equal(stripeKeyMode('pk_test_example'), null);
  assert.equal(stripeKeyMode('sk_example'), null);
  assert.equal(stripeKeyMode(undefined), null);
});

test('a key that does not match its environment is refused', () => {
  assert.equal(billingEnvironmentWithKey(TEST_ENV), 'test');
  assert.equal(billingEnvironmentWithKey(LIVE_ENV), 'live');
  // These two are the ones that matter. A live key on a developer machine could
  // charge real customers, and a test key in production would create
  // subscriptions Stripe never bills.
  assert.equal(billingEnvironmentWithKey({ ...TEST_ENV, STRIPE_SECRET_KEY: 'sk_live_example' }), null);
  assert.equal(billingEnvironmentWithKey({ ...LIVE_ENV, STRIPE_SECRET_KEY: 'sk_test_example' }), null);
  // A restricted key is judged by the same rule, not waved through.
  assert.equal(billingEnvironmentWithKey({ ...TEST_ENV, STRIPE_SECRET_KEY: 'rk_live_example' }), null);
  assert.equal(billingEnvironmentWithKey({ ...LIVE_ENV, STRIPE_SECRET_KEY: 'rk_test_example' }), null);
  assert.equal(billingEnvironmentWithKey({ ...LIVE_ENV, STRIPE_SECRET_KEY: undefined }), null);
});

test('return urls follow the environment and refuse an unknown one', () => {
  assert.equal(currentAppUrl(TEST_ENV), TEST_APP_URL);
  assert.equal(currentAppUrl(LIVE_ENV), LIVE_APP_URL);
  assert.throws(() => currentAppUrl({ ...LIVE_ENV, APP_URL: 'https://example.com' }));
});

test('a mode-specific object falls back to the Sandbox value only in the Test project', () => {
  // The fallback is what would send a Sandbox id to the live account, so it must
  // never apply there.
  assert.equal(stripeObject(TEST_ENV, 'STRIPE_CARDS_CONFIG_NAME'), SANDBOX_CARDS_CONFIG_NAME);
  assert.equal(stripeObject(LIVE_ENV, 'STRIPE_CARDS_CONFIG_NAME'), null);
  assert.equal(
    stripeObject({ ...LIVE_ENV, STRIPE_CARDS_CONFIG_NAME: 'RekodJa cards only' }, 'STRIPE_CARDS_CONFIG_NAME'),
    'RekodJa cards only',
  );
  assert.equal(
    stripeObject({ ...TEST_ENV, STRIPE_CARDS_CONFIG_NAME: '   ' }, 'STRIPE_CARDS_CONFIG_NAME'),
    SANDBOX_CARDS_CONFIG_NAME,
  );
});

test('each environment pins its own Stripe account', () => {
  // A Stripe Sandbox is an account of its own, so the live id differs. Assuming
  // one shared id would make a perfectly valid live key look wrong.
  assert.match(accountFor(TEST_ENV), /^acct_[A-Za-z0-9]+$/);
  assert.match(accountFor(LIVE_ENV), /^acct_[A-Za-z0-9]+$/);
  assert.notEqual(accountFor(TEST_ENV), accountFor(LIVE_ENV));
  assert.equal(accountFor({}), null);
});
