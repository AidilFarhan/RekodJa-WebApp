import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const billingDir = new URL('../src/lib/billing/', import.meta.url);

test('every livemode check compares against the environment', async () => {
  // Tests and the Sandbox only ever see livemode=false, so a bare
  // `x.livemode` rejection passes them all and then refuses every live object
  // on the day billing goes live. Each check must compare with liveMode().
  const files = (await readdir(billingDir)).filter(name => /\.(ts|mjs)$/.test(name));
  const offenders = [];
  let checks = 0;
  for (const name of files) {
    const source = await readFile(new URL(name, billingDir), 'utf8');
    for (const match of source.matchAll(/\.livemode\b(.{0,40})/g)) {
      checks++;
      if (!/^\s*[!=]==\s*liveMode\(process\.env\)/.test(match[1])) offenders.push(`${name}: ${match[0].trim()}`);
    }
  }
  assert.ok(checks >= 9, `expected the known livemode checks, found ${checks}`);
  assert.deepEqual(offenders, []);
});

test('the webhook trims its signing secret before verifying', async () => {
  const route = await readFile(new URL('../src/app/api/billing/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /process\.env\.STRIPE_WEBHOOK_SECRET\?\.trim\(\)/);
});
