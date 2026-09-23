/*
 * Validates the hosted SQL script `supabase/tests/security_rls_phase1.sql`
 * by running it end-to-end against PGlite.
 *
 * The hosted script is the one a human pastes into the Supabase SQL Editor,
 * where a syntax error costs a round trip. This test makes sure the file
 * executes cleanly and its internal assertions pass, so the hosted run is a
 * formality.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });

const MIGRATIONS = [
  '202609170001_profiles.sql',
  '202609180001_applications_and_sheets.sql',
  '202609180002_replied_events.sql',
  '202609180003_follow_up_events.sql',
  '202609180004_import_issues.sql',
  '202609180005_profiles_name_confirmed.sql',
  '202609180006_empty_name_trigger.sql',
  '202609180007_profiles_insert_grant.sql',
  '202609180008_url_match.sql',
  '202609190001_single_sheet_connection.sql',
  '202609200001_gmail_scan_candidates.sql',
  '202609200002_application_stage_replied.sql',
];

before(async () => {
  // Mirrors the Supabase environment the hosted script expects: the anon and
  // authenticated roles, the auth schema, and auth.uid() reading the JWT claim.
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);

  for (const file of MIGRATIONS) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
});

after(() => db.close());

test('security_rls_phase1.sql executes and all of its assertions pass', async () => {
  const sql = await readFile(new URL('../supabase/tests/security_rls_phase1.sql', import.meta.url), 'utf8');
  try {
    await db.exec(sql);
  } catch (error) {
    assert.fail(`hosted script failed: ${error.message}`);
  }
});

test('hosted script leaves no fixture rows behind', async () => {
  const { rows } = await db.query(`select
    (select count(*) from auth.users)::int as users,
    (select count(*) from public.applications)::int as applications,
    (select count(*) from public.sheet_connections)::int as connections`);
  assert.deepEqual(rows[0], { users: 0, applications: 0, connections: 0 });
});

test('the enum assertion fails when 202609200002 has not run', async () => {
  // A check that has never been seen to fail is not a check. This recreates
  // the exact state of a database that never received the Replied migration
  // and asserts that section J catches it.
  const stale = new PGlite({ extensions: { pgcrypto } });
  try {
    await stale.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;`);

    for (const file of MIGRATIONS.filter((f) => f !== '202609200002_application_stage_replied.sql')) {
      await stale.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }

    const sql = await readFile(new URL('../supabase/tests/security_rls_phase1.sql', import.meta.url), 'utf8');
    await assert.rejects(
      () => stale.exec(sql),
      /FAIL J: application_stage is missing value\(s\).*Replied/,
      'section J did not catch a database missing the Replied stage',
    );
  } finally {
    await stale.close();
  }
});
