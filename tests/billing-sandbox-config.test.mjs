import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SANDBOX_CARDS_CONFIG_NAME } from '../src/lib/billing/plans.ts';

test('the cards-only configuration name is a single exported source of truth', () => {
  assert.equal(typeof SANDBOX_CARDS_CONFIG_NAME, 'string');
  assert.ok(SANDBOX_CARDS_CONFIG_NAME.trim().length > 0);
});

test('no call site hardcodes the configuration name', async () => {
  // The app and the sandbox checker both look the configuration up by name. If
  // one drifted, the checker would report PASS while Checkout threw a generic
  // "Cards-only configuration is not ready", which is very hard to diagnose
  // from outside. The app now reads the name through stripeObject(), which is
  // the only module allowed to fall back to the Sandbox default.
  const callSites = [
    ['../src/lib/billing/checkout.ts', /stripeObject\(/],
    ['../scripts/billing-sandbox-check.mjs', /SANDBOX_CARDS_CONFIG_NAME/],
  ];
  for (const [path, expected] of callSites) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, expected, `${path} must read the shared name`);
    assert.doesNotMatch(source, new RegExp(SANDBOX_CARDS_CONFIG_NAME), `${path} must not repeat the literal`);
  }
  const mapper = await readFile(new URL('../src/lib/billing/stripe-objects.mjs', import.meta.url), 'utf8');
  assert.match(mapper, /SANDBOX_CARDS_CONFIG_NAME/, 'stripe-objects.mjs must import the shared default');
  assert.doesNotMatch(mapper, new RegExp(SANDBOX_CARDS_CONFIG_NAME), 'the default must not be repeated as a literal');
});
