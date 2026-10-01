import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export async function deleteAccount'), source.indexOf('export async function saveProfile'));

test('account deletion checks the subscription before deleting anything', () => {
  // Stripe would keep charging a running subscription after the account is gone.
  const check = body.indexOf('readSubscription(');
  const firstDelete = body.search(/\.delete\(\)|\.rpc\(/);
  assert.ok(check > 0 && firstDelete > 0 && check < firstDelete);
  assert.match(body, /cancel_at_period_end/);
});

test('account deletion removes Gmail scan results and stops on any failed step', () => {
  assert.match(body, /rpc\('delete_own_gmail_scan_candidates'\)/);
  assert.match(body, /if \(error\) redirect\(/);
});
