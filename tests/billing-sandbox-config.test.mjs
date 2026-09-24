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
  // "Cards-only Sandbox configuration is not ready", which is very hard to
  // diagnose from outside. Pin both call sites to the shared constant.
  for (const path of ['../src/lib/billing/checkout.ts', '../scripts/billing-sandbox-check.mjs']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /SANDBOX_CARDS_CONFIG_NAME/, `${path} must use the shared constant`);
    assert.doesNotMatch(source, new RegExp(SANDBOX_CARDS_CONFIG_NAME), `${path} must not repeat the literal`);
  }
});
