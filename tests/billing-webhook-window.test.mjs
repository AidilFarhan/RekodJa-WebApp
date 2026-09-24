import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { failureWindowStart } from '../src/lib/billing/stripe-state.ts';

const DAY = 86_400;

test('the first-failure window still covers the real-time failure event', () => {
  const now = Math.floor(Date.parse('2026-09-24T19:46:40Z') / 1000);
  const failureEvent = now; // Stripe stamps Event.created on the real clock.

  // Production: the invoice is created at real time, so both anchors agree.
  const production = failureWindowStart(now, now);
  assert.equal(production, now - DAY);
  assert.ok(failureEvent >= production);

  // Test Clock ahead of real time: invoice.created is the clock's future date,
  // which is the case that used to match nothing.
  const clockAhead = Math.floor(Date.parse('2027-01-08T19:39:58Z') / 1000);
  const skewed = failureWindowStart(clockAhead, now);
  assert.equal(skewed, now - DAY, 'the earlier clock must win');
  assert.ok(failureEvent >= skewed, 'the failure event must fall inside the window');
  assert.ok(failureEvent < clockAhead - DAY, 'anchoring on invoice.created alone would have missed it');

  // Test Clock behind real time: the invoice is the older anchor.
  const clockBehind = now - 30 * DAY;
  const behind = failureWindowStart(clockBehind, now);
  assert.equal(behind, clockBehind - DAY);
});

test('the window is anchored strictly before its inputs, never after', () => {
  for (const invoiceCreated of [0, 1_000, 1_790_279_200, 1_799_437_198]) {
    for (const nowSeconds of [0, 1_000, 1_790_279_200, 1_799_437_198]) {
      const start = failureWindowStart(invoiceCreated, nowSeconds);
      assert.ok(start < Math.min(invoiceCreated, nowSeconds), `${invoiceCreated}/${nowSeconds}`);
      assert.equal(start, Math.min(invoiceCreated, nowSeconds) - DAY);
    }
  }
});

test('the webhook looks up failures through the shared window helper', async () => {
  // Guards the wiring, not just the arithmetic: a refactor back to a bare
  // invoice.created bound would silently reintroduce the 500 on every past_due
  // event, which no unit test of the helper alone would catch.
  const source = await readFile(new URL('../src/lib/billing/webhook.ts', import.meta.url), 'utf8');
  assert.match(source, /created:\s*\{\s*gte:\s*windowStart\s*\}/);
  assert.match(source, /failureWindowStart\(invoice\.created/);
  assert.doesNotMatch(source, /gte:\s*invoice\.created/);
});
