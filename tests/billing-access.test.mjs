import test from 'node:test';
import assert from 'node:assert/strict';
import { isPro, PRO_GRACE_MS } from '../src/lib/billing/access.ts';

const now = Date.parse('2026-09-24T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const base = { status: 'active', trial_end: null, current_period_end: iso(now + 1000), past_due_at: null, cancel_at_period_end: false };

test('free and non-entitled states deny access', () => {
  assert.equal(isPro(null, now), false);
  for (const status of ['canceled', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'unknown']) {
    assert.equal(isPro({ ...base, status }, now), false);
  }
});

test('trial cancellation retains access only until the trial deadline', () => {
  const trial = { ...base, status: 'trialing', trial_end: iso(now + 1000), cancel_at_period_end: true };
  assert.equal(isPro(trial, now), true);
  assert.equal(isPro(trial, now + 1000), false);
  assert.equal(isPro({ ...trial, trial_end: null }, now), false);
});

test('active access ends at the paid period deadline', () => {
  for (const cancel_at_period_end of [false, true]) {
    assert.equal(isPro({ ...base, cancel_at_period_end }, now), true);
    assert.equal(isPro({ ...base, cancel_at_period_end }, now + 1000), false);
  }
});

test('past_due grants exactly seven days from the first failure', () => {
  const due = { ...base, status: 'past_due', past_due_at: iso(now) };
  assert.equal(isPro(due, now), true);
  assert.equal(isPro(due, now + PRO_GRACE_MS - 1), true);
  assert.equal(isPro(due, now + PRO_GRACE_MS), false);
  for (const past_due_at of [null, 'invalid', iso(now + 1)]) {
    assert.equal(isPro({ ...due, past_due_at }, now), false);
  }
});
