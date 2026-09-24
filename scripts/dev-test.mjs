import {
  readFile,
  lstat,
  readdir,
  mkdir,
  copyFile,
  mkdtemp,
  symlink,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isTestLegacyKey } from '../src/lib/billing/test-environment.mjs';
import { parseBetaEmails, parseBetaEndsAt } from '../src/lib/billing/beta.ts';

const appKeys = new Set([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'APP_URL',
  'BETA_TESTER_EMAILS',
  'BETA_ENDS_AT',
  'GMAIL_GATE_ENFORCED',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_PICKER_API_KEY',
  'GOOGLE_CLOUD_PROJECT_NUMBER',
  'GMAIL_AUTO_CONFIRM',
  'GEMINI_MAX_CALLS',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_EVAL_CALLS',
]);

const systemKeys = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
]);

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

function check(label, passed, report) {
  report(`${label}: ${passed ? 'PASS' : 'FAIL'}`);

  if (!passed) {
    throw new Error('Unsafe test configuration');
  }
}

export function validateTestEnv(values, report = () => {}) {
  check(
    'ENV_KEYS_ALLOWED',
    Object.keys(values).every(key => appKeys.has(key)),
    report,
  );

  check(
    'SUPABASE_NOT_PRODUCTION',
    !values.SUPABASE_URL?.includes('dhndublwvgylxlrbwwyu'),
    report,
  );

  check(
    'SUPABASE_TEST_URL',
    values.SUPABASE_URL ===
      'https://zfcxgfiqmirkqerqzsny.supabase.co',
    report,
  );

  let publicKey = Boolean(
    values.SUPABASE_ANON_KEY?.startsWith('sb_publishable_'),
  );

  try {
    const parts = (values.SUPABASE_ANON_KEY || '').split('.');

    if (parts.length === 3) {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString(),
      );

      publicKey =
        payload.role === 'anon' &&
        payload.ref === 'zfcxgfiqmirkqerqzsny';
    }
  } catch {
    publicKey = false;
  }

  check('SUPABASE_PUBLIC_KEY', publicKey, report);

  check(
    'SUPABASE_TEST_ADMIN_KEY_OR_EMPTY',
    !values.SUPABASE_SERVICE_ROLE_KEY ||
      isTestLegacyKey(values.SUPABASE_SERVICE_ROLE_KEY, 'service_role'),
    report,
  );

  check(
    'STRIPE_TEST_KEY_OR_EMPTY',
    !values.STRIPE_SECRET_KEY ||
      values.STRIPE_SECRET_KEY.startsWith('sk_test_'),
    report,
  );

  check(
    'APP_URL_LOCALHOST_3002',
    values.APP_URL === 'http://localhost:3002',
    report,
  );

  // A deadline the app cannot read is treated as "beta over", so a typo here
  // would silently lock testers out. Catch it at launch instead.
  check(
    'BETA_ENDS_AT_PARSES',
    !values.BETA_ENDS_AT || parseBetaEndsAt(values.BETA_ENDS_AT) !== null,
    report,
  );

  // Labels only: the report never echoes an address.
  check(
    'BETA_TESTER_EMAILS_SHAPE',
    parseBetaEmails(values.BETA_TESTER_EMAILS).every(address =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address),
    ),
    report,
  );

  // Only '1' switches the production gate on. Anything else reads as off, so a
  // value like 'true' would look active while leaving every user ungated.
  check(
    'GMAIL_GATE_ENFORCED_FLAG',
    values.GMAIL_GATE_ENFORCED === undefined ||
      ['0', '1'].includes(values.GMAIL_GATE_ENFORCED),
    report,
  );
}

export async function loadTestEnv(
  root,
  inherited = process.env,
  report = () => {},
) {
  const envPath = join(root, '.env.stripe-test.local');

  check(
    'TEST_ENV_REGULAR_FILE',
    (await lstat(envPath)).isFile(),
    report,
  );

  const values = parseEnv(
    await readFile(envPath, 'utf8'),
  );

  validateTestEnv(values, report);

  const env = Object.fromEntries(
    Object.entries(inherited).filter(([key]) =>
      systemKeys.has(key.toUpperCase()),
    ),
  );

  Object.assign(env, values, {
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
  });

  return env;
}

async function copyTree(source, target) {
  const stat = await lstat(source);

  if (stat.isSymbolicLink()) {
    throw new Error('Source links are not supported');
  }

  if (stat.isDirectory()) {
    await mkdir(target, { recursive: true });

    for (const name of await readdir(source)) {
      if (
        name.startsWith('.env') ||
        ['.next', '.git', 'node_modules'].includes(name)
      ) {
        continue;
      }

      await copyTree(
        join(source, name),
        join(target, name),
      );
    }

    return;
  }

  if (stat.isFile()) {
    await copyFile(source, target);
    return;
  }

  throw new Error('Unsupported source file');
}

export async function prepareRuntime(root) {
  const runtime = await mkdtemp(
    join(tmpdir(), 'rekodja-stripe-test-'),
  );

  const allowed = new Set([
    'src',
    'public',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'next-env.d.ts',
  ]);

  for (const name of await readdir(root)) {
    if (/^(next|postcss|tailwind)\.config\./.test(name)) {
      throw new Error('Review new build configuration');
    }

    if (allowed.has(name)) {
      await copyTree(
        join(root, name),
        join(runtime, name),
      );
    }
  }

  for (const required of [
    'src',
    'package.json',
    'tsconfig.json',
  ]) {
    await lstat(join(runtime, required));
  }

  await symlink(
    join(root, 'node_modules'),
    join(runtime, 'node_modules'),
    process.platform === 'win32'
      ? 'junction'
      : 'dir',
  );

  return runtime;
}

// Never forward raw child output: arbitrary errors may contain any secret,
// including credentials split across stream chunks. Emit fixed labels only.
export function createSafeReporter(report) {
  const seen = new Set();
  let tail = '';
  return chunk => {
    const output = tail + String(chunk);
    tail = output.slice(-80);
    const labels = [];
    if (/EADDRINUSE/.test(output)) labels.push('PORT_3002_AVAILABLE: FAIL');
    if (/Ready in\s+\d/i.test(output)) labels.push('APP_READY: PASS');
    if (/Failed to compile|Module not found|TypeError:|ReferenceError:|SyntaxError:/i.test(output)) {
      labels.push('APP_RUNTIME: FAIL');
    }
    for (const label of labels) {
      if (!seen.has(label)) {
        seen.add(label);
        report(label);
      }
    }
  };
}

export async function main(
  args = process.argv.slice(2),
) {
  const report = message => console.log(message);

  try {
    check(
      'LAUNCHER_ARGUMENTS',
      args.length === 0 ||
        (args.length === 1 && args[0] === '--check'),
      report,
    );

    const env = await loadTestEnv(
      projectRoot,
      process.env,
      report,
    );

    if (args[0] === '--check') {
      return;
    }

    const runtime = await prepareRuntime(projectRoot);

    check(
      'ISOLATED_RUNTIME',
      !(await readdir(runtime)).some(name =>
        name.startsWith('.env'),
      ),
      report,
    );

    const nextBinary = join(
      runtime,
      'node_modules',
      'next',
      'dist',
      'bin',
      'next',
    );

    const child = spawn(
      process.execPath,
      [
        nextBinary,
        'dev',
        '--webpack',
        '--hostname',
        'localhost',
        '--port',
        '3002',
        runtime,
      ],
      {
        cwd: runtime,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      },
    );

    child.stdout.on('data', createSafeReporter(report));
    child.stderr.on('data', createSafeReporter(report));

    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => {
        child.kill(signal);
      });
    }

    child.once('error', () => {
      report('APP_PROCESS: FAIL');
      process.exitCode = 1;
    });

    child.once('exit', (code, signal) => {
      const success =
        code === 0 ||
        signal === 'SIGINT' ||
        signal === 'SIGTERM';

      report(
        `APP_PROCESS: ${success ? 'PASS' : 'FAIL'}`,
      );

      process.exitCode = success ? 0 : 1;
    });
  } catch {
    report('TEST_LAUNCHER: FAIL');
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)
) {
  await main();
}
