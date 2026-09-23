import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/auth/callback/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

for (const scenario of [
  { intent: 'login', registered: false, path: '/sign-in?notice=create-first', accepted: false },
  { intent: 'signup', registered: true, path: '/sign-in?notice=already-exists', accepted: false },
  { intent: 'signup', registered: false, path: '/tracker-setup', accepted: true },
  { intent: 'login', registered: true, path: '/tracker-setup', accepted: true },
  { intent: undefined, registered: true, path: '/sign-in?error=expired', accepted: false },
  { intent: 'login', registered: false, lookupError: true, path: '/sign-in?error=registration', accepted: false },
  { intent: 'signup', registered: false, insertCode: '23505', path: '/sign-in?notice=already-exists', accepted: false },
]) test(`OAuth ${JSON.stringify(scenario)}`, async () => {
  const written = [];
  let inserted = false;
  let revoked = false;
  const jar = { get: () => ({ value: scenario.intent }), delete() {}, getAll: () => [], set: (name) => written.push(name) };
  const mocks = {
    'next/server': { NextResponse: { redirect: (url) => url } },
    'next/headers': { cookies: async () => jar },
    '@/lib/config': { configuration: () => ({ appUrl: 'https://example.com', url: 'https://db.example.com', key: 'public' }) },
    '@supabase/ssr': { createServerClient: (_url, _key, options) => ({
      auth: {
        exchangeCodeForSession: async () => { options.cookies.setAll([{ name: 'auth-session', value: 'secret', options: {} }]); return { data: { user: { id: 'user-1' } }, error: null }; },
        signOut: async () => { revoked = true; return { error: null }; },
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: scenario.registered ? { user_id: 'user-1' } : null, error: scenario.lookupError }) }) }),
        insert: async () => { inserted = true; return { error: scenario.insertCode ? { code: scenario.insertCode } : null }; },
      }),
    }) },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => { assert.ok(mocks[name], name); return mocks[name]; }, exports);
  const result = await exports.GET({ nextUrl: new URL('https://example.com/auth/callback?code=verified-code') });
  assert.equal(result, `https://example.com${scenario.path}`);
  assert.equal(written.includes('auth-session'), scenario.accepted);
  assert.equal(inserted, scenario.intent === 'signup' && !scenario.registered);
  assert.equal(revoked, Boolean(scenario.intent) && !scenario.accepted);
});
