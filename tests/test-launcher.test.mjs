import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTestEnv, loadTestEnv, prepareRuntime, createSafeReporter } from '../scripts/dev-test.mjs';
import { isTestLegacyKey, assertTestEnvironment } from '../src/lib/billing/test-environment.mjs';

const valid = {
  SUPABASE_URL: 'https://zfcxgfiqmirkqerqzsny.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  APP_URL: 'http://localhost:3002',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
};
const jwt = (role, ref = 'zfcxgfiqmirkqerqzsny') => `header.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.signature`;

test('launcher fails closed for wrong project, URL, live key and unknown env keys', () => {
  assert.doesNotThrow(() => validateTestEnv(valid));
  for (const patch of [
    { SUPABASE_URL: 'https://dhndublwvgylxlrbwwyu.supabase.co' },
    { SUPABASE_URL: valid.SUPABASE_URL + '.attacker.example' },
    { SUPABASE_URL: '' }, { APP_URL: 'http://localhost:3000' },
    { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { NODE_OPTIONS: '--inspect' },
    { SUPABASE_ANON_KEY: jwt('service_role') },
    { SUPABASE_SERVICE_ROLE_KEY: jwt('service_role', 'dhndublwvgylxlrbwwyu') },
    { SUPABASE_SERVICE_ROLE_KEY: jwt('anon') },
  ]) {
    const reports = [];
    assert.throws(() => validateTestEnv({ ...valid, ...patch }, line => reports.push(line)));
    assert.ok(reports.every(line => /^[A-Z0-9_]+: (PASS|FAIL)$/.test(line)));
  }
  assert.doesNotThrow(() => validateTestEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }));
  assert.equal(isTestLegacyKey('invalid', 'service_role'), false);
  assert.throws(() => assertTestEnvironment({ ...valid, APP_URL: 'https://app.rekodja.com' }));
});

test('only explicit test env is loaded; inherited application secrets never leak in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rekodja-launcher-test-'));
  try {
    await writeFile(join(root, '.env.stripe-test.local'), Object.entries(valid).map(([key, value]) => `${key}=${value}`).join('\n'));
    await writeFile(join(root, '.env.local'), 'STRIPE_SECRET_KEY=sk_live_do_not_load\nGEMINI_API_KEY=do_not_load');
    const env = await loadTestEnv(root, { PATH: 'safe-path', STRIPE_SECRET_KEY: 'sk_live_inherited', NODE_OPTIONS: '--inspect', GEMINI_API_KEY: 'inherited' });
    assert.equal(env.STRIPE_SECRET_KEY, valid.STRIPE_SECRET_KEY);
    assert.equal(env.PATH, 'safe-path');
    assert.equal(env.GEMINI_API_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    await rm(join(root, '.env.stripe-test.local'));
    await assert.rejects(loadTestEnv(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime snapshot excludes every env file and source .next cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rekodja-launcher-test-'));
  let runtime;
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(root, '.next'));
    await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = true;');
    await writeFile(join(root, 'src', '.env.local'), 'SECRET=do_not_load');
    await writeFile(join(root, '.env.local'), 'SECRET=do_not_load');
    await writeFile(join(root, '.env.stripe-test.local'), 'SECRET=do_not_copy');
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'tsconfig.json'), '{}');
    runtime = await prepareRuntime(root);
    assert.ok(!(await readdir(runtime)).some(name => name.startsWith('.env') || name === '.next'));
    assert.deepEqual(await readdir(join(runtime, 'src')), ['hello.ts']);
    assert.equal(await readFile(join(runtime, 'src', 'hello.ts'), 'utf8'), 'export const hello = true;');
    await writeFile(join(root, 'next.config.js'), 'export default {};');
    await assert.rejects(prepareRuntime(root), /Review new build configuration/);
  } finally {
    if (runtime) await rm(runtime, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('child output emits only fixed labels, even with secrets split between chunks', () => {
  const reports = [];
  const report = createSafeReporter(line => reports.push(line));
  report('Ready in 12ms sk_test_arbitrary\n');
  report('client_secret=not-a-stripe-key\nTypeError: token=');
  report('arbitrary-sensitive-value\nEADDR');
  report('INUSE 3002');
  assert.deepEqual(reports, ['APP_READY: PASS', 'APP_RUNTIME: FAIL', 'PORT_3002_AVAILABLE: FAIL']);
});
