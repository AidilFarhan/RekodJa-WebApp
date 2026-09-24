import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gmailAccess,
  isBetaTester,
  normaliseEmail,
  parseBetaEmails,
  parseBetaEndsAt,
} from '../src/lib/billing/beta.ts';

// Example addresses only. The real tester list is an environment variable and
// must never appear in the repo, a test, or a log.
const LIST = 'beta-a@example.com, Beta-B@Example.com ,,  beta-c@example.com  ,';
const ENDS_RAW = '2026-09-30T23:59:59+08:00';
const ENDS_MS = Date.parse(ENDS_RAW);
const BEFORE = Date.parse('2026-09-30T15:59:58Z'); // one second before the deadline
const AT = Date.parse('2026-09-30T15:59:59Z');
const AFTER = Date.parse('2026-10-01T00:00:00Z');

test('the list is normalised, and empty entries are ignored', () => {
  assert.deepEqual(parseBetaEmails(LIST), [
    'beta-a@example.com',
    'beta-b@example.com',
    'beta-c@example.com',
  ]);
  assert.deepEqual(parseBetaEmails(''), []);
  assert.deepEqual(parseBetaEmails(undefined), []);
  assert.deepEqual(parseBetaEmails('   ,  ,  '), []);
  assert.equal(normaliseEmail('  Mixed@Case.COM  '), 'mixed@case.com');
  assert.equal(normaliseEmail(null), '');
});

test('a missing or unparseable deadline fails closed', () => {
  assert.equal(parseBetaEndsAt(ENDS_RAW), ENDS_MS);
  // The offset must be honoured: the deadline is 15:59:59Z, not 23:59:59Z.
  assert.equal(new Date(ENDS_MS).toISOString(), '2026-09-30T15:59:59.000Z');
  assert.equal(parseBetaEndsAt('2026-09-30T15:59:59Z'), ENDS_MS);

  // Date.parse accepts every one of these, so the shape check has to reject
  // them first: an ambiguous deadline must never be adopted silently.
  for (const bad of [
    undefined, '', '   ', 'not-a-date', '2026-13-45',
    '30 Sep 2026',              // human date, no time, no zone
    '2026-09-30',               // date only
    '2026-09-30T23:59:59',      // local time, zone not stated
    '2026-09-30 23:59:59+08:00',
    '2026-09-30T23:59:59+0800',
    '2026-09-30T23:59:59+08:00Z',
  ]) {
    assert.equal(parseBetaEndsAt(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('a listed tester is recognised regardless of case or surrounding space', () => {
  const emails = parseBetaEmails(LIST);
  for (const email of [
    'beta-a@example.com',
    'BETA-A@EXAMPLE.COM',
    '  beta-a@example.com  ',
    'Beta-B@Example.com',
    'beta-c@example.com',
  ]) {
    assert.equal(isBetaTester(email, emails, ENDS_MS, BEFORE), true, email);
  }
});

test('anyone not on the list is denied, and an absent address is never a match', () => {
  const emails = parseBetaEmails(LIST);
  for (const email of ['beta-d@example.com', 'beta-a@example.com.evil.test', 'example.com', 'beta-a', '']) {
    assert.equal(isBetaTester(email, emails, ENDS_MS, BEFORE), false, email);
  }
  for (const email of [null, undefined, '   ']) {
    assert.equal(isBetaTester(email, emails, ENDS_MS, BEFORE), false, String(email));
  }
  // An empty configured list must never match, even for an empty address.
  assert.equal(isBetaTester('', [], ENDS_MS, BEFORE), false);
});

test('the deadline window is half-open: before yes, at and after no', () => {
  const emails = parseBetaEmails(LIST);
  assert.equal(isBetaTester('beta-a@example.com', emails, ENDS_MS, BEFORE), true);
  assert.equal(isBetaTester('beta-a@example.com', emails, ENDS_MS, AT), false);
  assert.equal(isBetaTester('beta-a@example.com', emails, ENDS_MS, AFTER), false);
});

test('a missing deadline or an unusable clock denies everyone', () => {
  const emails = parseBetaEmails(LIST);
  assert.equal(isBetaTester('beta-a@example.com', emails, null, BEFORE), false);
  assert.equal(isBetaTester('beta-a@example.com', emails, parseBetaEndsAt('rubbish'), BEFORE), false);
  assert.equal(isBetaTester('beta-a@example.com', emails, ENDS_MS, Number.NaN), false);
});

test('a real subscription outranks beta', () => {
  assert.equal(gmailAccess(true, true), 'subscription');
  assert.equal(gmailAccess(true, false), 'subscription');
  assert.equal(gmailAccess(false, true), 'beta');
  assert.equal(gmailAccess(false, false), 'denied');
});
