/*
 * Phase 1 security review — authorization / RLS tests.
 *
 * Runs the real migrations in an in-process Postgres (PGlite) and attacks
 * the schema as a second authenticated user. This is the regression suite
 * for the Phase 1 findings: if someone drops a policy, disables RLS, or
 * removes a composite foreign key, these tests fail.
 *
 * Companion file `supabase/tests/security_rls_phase1.sql` runs the same
 * assertions against the hosted database in the SQL Editor.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// 202609190001_single_sheet_connection.sql runs `create extension pgcrypto`,
// so the extension has to be registered with PGlite up front.
const db = new PGlite({ extensions: { pgcrypto } });

const owner = 'e1111111-1111-4111-8111-111111111111';
const attacker = 'e2222222-2222-4222-8222-222222222222';
const connection = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const application = 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const issue = 'eccccccc-cccc-4ccc-8ccc-cccccccccccc';
const candidate = 'eddddddd-dddd-4ddd-8ddd-dddddddddddd';

const ALL_TABLES = [
  'profiles',
  'sheet_connections',
  'applications',
  'application_events',
  'import_issues',
  'gmail_scan_candidates',
];

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

  // Fixtures, all owned by the first user. Rolled back per test by asRole.
  await db.query(`insert into auth.users values ($1, '{}'), ($2, '{}')`, [owner, attacker]);
  await db.query(
    `insert into public.sheet_connections(id,user_id,spreadsheet_id,spreadsheet_name,sheet_name)
     values ($1,$2,'phase1-sheet','Phase1','Applications')`,
    [connection, owner],
  );
  await db.query(
    `insert into public.applications(id,user_id,company,role,stage,date_applied,sheet_connection_id,import_key)
     values ($1,$2,'Owner Co','Engineer','Applied','2026-09-18',$3,$4)`,
    [application, owner, connection, '1'.repeat(64)],
  );
  await db.query(
    `insert into public.import_issues(id,user_id,sheet_connection_id,message) values ($1,$2,$3,'Row 7 is missing a company name.')`,
    [issue, owner, connection],
  );
  await db.query(
    `insert into public.gmail_scan_candidates(id,user_id,message_id,subject,matched_application_id)
     values ($1,$2,'phase1-message-1','Interview invitation',$3)`,
    [candidate, owner, application],
  );
  await db.query(
    `insert into public.application_events(user_id,application_id,event_status,event_type,to_stage)
     values ($1,$2,'user_confirmed','stage_change','Applied')`,
    [owner, application],
  );
});

after(() => db.close());

async function asRole(role, claim, callback) {
  await db.exec('begin');
  try {
    if (claim) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claim]);
    await db.exec(`set local role ${role}`);
    return await callback();
  } finally {
    await db.exec('rollback');
  }
}

const asOwner = (cb) => asRole('authenticated', owner, cb);
const asAttacker = (cb) => asRole('authenticated', attacker, cb);

// ---------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------

test('every table in public has RLS enabled', async () => {
  const { rows } = await db.query(`
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assert.deepEqual(rows, [], `tables without RLS: ${rows.map((r) => r.relname).join(', ')}`);
});

test('every granted command has a matching policy for authenticated', async () => {
  const { rows } = await db.query(`
    select c.relname as table_name, p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, p.priv)
      and not exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public' and pol.tablename = c.relname
          and (pol.cmd = p.priv or pol.cmd = 'ALL')
          and ('authenticated' = any(pol.roles) or 'public' = any(pol.roles))
      )`);
  assert.deepEqual(rows, [], `granted but unprotected: ${JSON.stringify(rows)}`);
});

test('anon is locked out of every table', async () => {
  for (const table of ALL_TABLES) {
    await assert.rejects(
      () => asRole('anon', null, () => db.query(`select count(*) from public.${table}`)),
      /permission denied/i,
      `anon could SELECT from public.${table}`,
    );
    await assert.rejects(
      () => asRole('anon', null, () => db.query(`insert into public.${table} default values`)),
      /permission denied|violates|not-null|null value/i,
      `anon could INSERT into public.${table}`,
    );
  }
});

// ---------------------------------------------------------------------
// Cross-user isolation
// ---------------------------------------------------------------------

test('a second user cannot read any of the first user rows', async () => {
  const checks = [
    ['profiles', `select 1 from public.profiles where id = $1`],
    ['sheet_connections', `select 1 from public.sheet_connections where id = $1`],
    ['applications', `select 1 from public.applications where id = $1`],
    ['application_events', `select 1 from public.application_events where user_id = $1`],
    ['import_issues', `select 1 from public.import_issues where id = $1`],
    ['gmail_scan_candidates', `select 1 from public.gmail_scan_candidates where id = $1`],
  ];
  const ids = { profiles: owner, sheet_connections: connection, applications: application, application_events: owner, import_issues: issue, gmail_scan_candidates: candidate };

  for (const [label, sql] of checks) {
    const { rows } = await asAttacker(() => db.query(sql, [ids[label]]));
    assert.equal(rows.length, 0, `cross-user read of ${label} succeeded`);
  }
});

/*
 * A cross-user write attempt is blocked either by RLS filtering the row
 * (0 rows affected) or by a missing grant (permission denied). Both are
 * acceptable; a write that succeeds is not.
 */
async function assertWriteBlocked(label, sql, id) {
  try {
    const { rows } = await asAttacker(() => db.query(sql, [id]));
    assert.equal(rows.length, 0, `${label} touched another user's row`);
  } catch (error) {
    assert.match(
      String(error.message),
      /permission denied|row-level security/i,
      `${label} was blocked for an unexpected reason: ${error.message}`,
    );
  }
}

test('cross-user UPDATE and DELETE by primary key never succeed', async () => {
  // These mirror the route handlers that filter by id alone and rely on RLS:
  //   PATCH/DELETE /api/applications/[id]
  //   POST  /api/applications/[id]/follow-up
  //   DELETE /api/import-issues/[id]
  //   PATCH /api/gmail/scan/candidates
  //   POST  /api/sheet-connections
  await assertWriteBlocked('applications.update', `update public.applications set stage = 'Rejected' where id = $1 returning id`, application);
  await assertWriteBlocked('applications.delete', `delete from public.applications where id = $1 returning id`, application);
  await assertWriteBlocked('import_issues.update', `update public.import_issues set message = 'Hijacked' where id = $1 returning id`, issue);
  await assertWriteBlocked('import_issues.delete', `delete from public.import_issues where id = $1 returning id`, issue);
  await assertWriteBlocked('gmail_scan_candidates.update', `update public.gmail_scan_candidates set review_state = 'confirmed' where id = $1 returning id`, candidate);
  await assertWriteBlocked('sheet_connections.update', `update public.sheet_connections set sheet_name = 'Hijacked' where id = $1 returning id`, connection);
  await assertWriteBlocked('profiles.update', `update public.profiles set display_name = 'Hijacked' where id = $1 returning id`, owner);
});

test('user_id spoofing on insert is rejected', async () => {
  await assert.rejects(
    () => asAttacker(() => db.query(
      `insert into public.applications (user_id,company,role,stage,date_applied) values ($1,'Spoof','Spoof','Applied','2026-09-18')`,
      [owner],
    )),
    /violates row-level security|permission denied/i,
  );
  await assert.rejects(
    () => asAttacker(() => db.query(
      `insert into public.import_issues (user_id,message) values ($1,'Spoofed')`,
      [owner],
    )),
    /violates row-level security|permission denied/i,
  );
  await assert.rejects(
    () => asAttacker(() => db.query(
      `insert into public.gmail_scan_candidates (user_id,message_id) values ($1,'spoofed-message')`,
      [owner],
    )),
    /violates row-level security|permission denied/i,
  );
});

test('cross-tenant foreign keys cannot be stitched together', async () => {
  // An attacker who knows another user's row ids still cannot attach their
  // own rows to them, because every link is a composite (id, user_id) FK.
  const attempts = [
    [`insert into public.applications (user_id,company,role,stage,date_applied,sheet_connection_id,import_key)
      values ($1,'Stitch Co','Engineer','Applied','2026-09-18',$2,$3)`, [attacker, connection, '2'.repeat(64)]],
    [`insert into public.application_events (user_id,application_id,event_status,event_type,to_stage)
      values ($1,$2,'user_confirmed','stage_change','Rejected')`, [attacker, application]],
    [`insert into public.gmail_scan_candidates (user_id,message_id,matched_application_id)
      values ($1,'stitched-message',$2)`, [attacker, application]],
    [`insert into public.import_issues (user_id,sheet_connection_id,message)
      values ($1,$2,'Stitched issue')`, [attacker, connection]],
  ];

  for (const [sql, params] of attempts) {
    await assert.rejects(
      () => asAttacker(() => db.query(sql, params)),
      /violates foreign key constraint/i,
      `cross-tenant link was accepted: ${sql.slice(0, 60)}`,
    );
  }
});

test('profiles.id cannot be rewritten by the authenticated role', async () => {
  // Rewriting your own id to another user's id is the real threat: it is
  // blocked by the row-level WITH CHECK (a rewritten id no longer equals
  // auth.uid()) rather than by the column grant, which is worth knowing —
  // the column grant is a second layer, not the only one.
  await assert.rejects(
    () => asAttacker(() => db.query(
      `update public.profiles set id = $1 where id = $2`, [owner, attacker],
    )),
    /permission denied|row-level security/i,
  );
});

test('import_sheet_application refuses another user connection id', async () => {
  await assert.rejects(
    () => asAttacker(() => db.query(
      `select * from public.import_sheet_application($1,$2,'Attacker Co','Engineer','Applied','2026-09-18','Other','https://example.com/attack')`,
      [connection, '3'.repeat(64)],
    )),
    /Sheet connection not found/,
  );
});

// ---------------------------------------------------------------------
// Positive controls — the tests above must not be passing on an empty DB
// ---------------------------------------------------------------------

test('owner still has full access to their own data', async () => {
  const { rows } = await asOwner(() => db.query(`
    select
      (select count(*) from public.sheet_connections)::int as connections,
      (select count(*) from public.applications)::int as applications,
      (select count(*) from public.application_events)::int as events,
      (select count(*) from public.import_issues)::int as issues,
      (select count(*) from public.gmail_scan_candidates)::int as candidates`));
  assert.deepEqual(rows[0], { connections: 1, applications: 1, events: 1, issues: 1, candidates: 1 });
});

test('owner can still change their own application stage', async () => {
  const { rows } = await asOwner(() => db.query(
    `update public.applications set stage = 'Interview' where id = $1 returning id`, [application],
  ));
  assert.equal(rows.length, 1);
});
