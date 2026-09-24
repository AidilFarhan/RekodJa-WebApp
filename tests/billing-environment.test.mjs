import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_APP_URL,
  TEST_APP_URL,
  TEST_SUPABASE_URL,
  billingEnvironment,
  billingEnvironmentWithKey,
  currentAppUrl,
  stripeKeyMode,
} from '../src/lib/billing/test-environment.mjs';
import { REKODJA_ACCOUNT, SANDBOX_CARDS_CONFIG_NAME } from '../src/lib/billing/plans.ts';
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

test('only Stripe secret key prefixes are recognised', () => {
  assert.equal(stripeKeyMode('sk_test_example'), 'test');
  assert.equal(stripeKeyMode('sk_live_example'), 'live');
  assert.equal(stripeKeyMode('pk_live_example'), null);
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

test('the account pin is mode-independent', () => {
  // Stripe reuses one account id across test and live mode, so this single pin
  // protects both and is what stops another account's key from being used.
  assert.match(REKODJA_ACCOUNT, /^acct_[A-Za-z0-9]+$/);
});
