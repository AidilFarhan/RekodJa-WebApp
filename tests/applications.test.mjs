import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const connection = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const application = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202609180001_applications_and_sheets.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180002_replied_events.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180003_follow_up_events.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180004_import_issues.sql', import.meta.url), 'utf8'));
  await db.query(`insert into auth.users values ($1, '{}'), ($2, '{}')`, [alice, bob]);
  await db.query(`insert into public.sheet_connections(id,user_id,spreadsheet_id,spreadsheet_name,sheet_name) values($1,$2,'sheet-a','Tracker','Applications')`, [connection, alice]);
  await db.query(`insert into public.applications(id,user_id,company,role,stage,date_applied,sheet_connection_id,import_key) values($1,$2,'Acme','Engineer','Applied','2026-09-01',$3,$4)`, [application, alice, connection, 'a'.repeat(64)]);
  await db.query(`insert into public.application_events(user_id,application_id,event_status,event_type,to_stage) values($1,$2,'user_confirmed','stage_change','Applied')`, [alice, application]);
});
after(() => db.close());

async function asUser(id, callback) {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id]);
    await db.exec('set local role authenticated');
    return await callback();
  } finally { await db.exec('rollback'); }
}

test('RLS is enabled on all milestone 2 tables', async () => {
  const { rows } = await db.query(`select relname, relrowsecurity from pg_class where oid in ('public.applications'::regclass,'public.application_events'::regclass,'public.sheet_connections'::regclass) order by relname`);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.relrowsecurity));
});

test('owner can read and write their application, event, and connection', async () => asUser(alice, async () => {
  assert.equal((await db.query('select * from public.sheet_connections')).rows.length, 1);
  assert.equal((await db.query('select * from public.applications')).rows.length, 1);
  assert.equal((await db.query('select * from public.application_events')).rows.length, 1);
  assert.equal((await db.query(`update public.applications set role='Senior Engineer' where id=$1 returning id`, [application])).rows.length, 1);
  assert.equal((await db.query(`insert into public.application_events(application_id,event_status,event_type,to_stage) values($1,'detected','stage_observation','Interview') returning id`, [application])).rows.length, 1);
}));

test('different authenticated user sees zero owner rows and cannot update them', async () => asUser(bob, async () => {
  assert.equal((await db.query('select * from public.sheet_connections')).rows.length, 0);
  assert.equal((await db.query('select * from public.applications')).rows.length, 0);
  assert.equal((await db.query('select * from public.application_events')).rows.length, 0);
  assert.equal((await db.query(`update public.applications set role='Hacked' where id=$1 returning id`, [application])).rows.length, 0);
  assert.equal((await db.query(`update public.application_events set source='Hacked' where application_id=$1 returning id`, [application])).rows.length, 0);
}));

test('foreign keys prevent cross-user application/event relationships', async () => asUser(bob, async () => {
  await assert.rejects(db.query(`insert into public.application_events(user_id,application_id,event_status,event_type,to_stage) values($1,$2,'detected','stage_observation','Interview')`, [bob, application]), /foreign key|row-level security/);
}));

test('sheet import is idempotent and creates one confirmed history event', async () => asUser(alice, async () => {
  const importKey = 'f'.repeat(64);
  const call = () => db.query(`select * from public.import_sheet_application($1,$2,'Beta','Designer','Applied'::public.application_stage,'2026-09-02','LinkedIn','https://example.com/job')`, [connection, importKey]);
  assert.equal((await call()).rows[0].created, true);
  assert.equal((await call()).rows[0].created, false);
  const count = await db.query(`select count(*)::int as count from public.applications where import_key=$1`, [importKey]);
  const events = await db.query(`select count(*)::int as count from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=$1`, [importKey]);
  assert.equal(count.rows[0].count, 1);
  assert.equal(events.rows[0].count, 1);
}));

test('re-import with a changed stage updates once and appends one event', async () => asUser(alice, async () => {
  const importKey = 'e'.repeat(64);
  await db.query(`select * from public.import_sheet_application($1,$2,'Gamma','Analyst','Applied'::public.application_stage,'2026-09-03','Referral','')`, [connection, importKey]);
  const changed = await db.query(`select * from public.import_sheet_application($1,$2,'Gamma','Analyst','Interview'::public.application_stage,'2026-09-03','Referral','')`, [connection, importKey]);
  const unchanged = await db.query(`select * from public.import_sheet_application($1,$2,'Gamma','Analyst','Interview'::public.application_stage,'2026-09-03','Referral','')`, [connection, importKey]);
  assert.equal(changed.rows[0].stage_changed, true);
  assert.equal(unchanged.rows[0].stage_changed, false);
  assert.equal((await db.query(`select count(*)::int as count from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=$1`, [importKey])).rows[0].count, 2);
}));

test('import accepts a null date and the application has no date', async () => asUser(alice, async () => {
  const importKey = 'c'.repeat(64);
  await db.query(`select * from public.import_sheet_application($1,$2,'Delta','SRE','Applied'::public.application_stage,null,'LinkedIn','')`, [connection, importKey]);
  const { rows } = await db.query(`select date_applied from public.applications where import_key=$1`, [importKey]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date_applied, null);
}));

test('replied import creates one employer_response event and stays Applied', async () => asUser(alice, async () => {
  const importKey = 'd'.repeat(64);
  const first = await db.query(`select * from public.import_sheet_application($1,$2,'Epsilon','PM','Applied'::public.application_stage,'2026-09-04','Referral','',true)`, [connection, importKey]);
  assert.equal(first.rows[0].created, true);
  const retry = await db.query(`select * from public.import_sheet_application($1,$2,'Epsilon','PM','Applied'::public.application_stage,'2026-09-04','Referral','',true)`, [connection, importKey]);
  assert.equal(retry.rows[0].created, false);
  assert.equal(retry.rows[0].stage_changed, false);
  const stage = await db.query(`select stage from public.applications where import_key=$1`, [importKey]);
  assert.equal(stage.rows[0].stage, 'Applied');
  const responseEvents = await db.query(`select count(*)::int as count from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=$1 and e.event_type='employer_response' and e.event_status='user_confirmed'`, [importKey]);
  assert.equal(responseEvents.rows[0].count, 1);
}));

test('replied added on a later import appends exactly one employer_response event', async () => asUser(alice, async () => {
  const importKey = 'b'.repeat(64);
  await db.query(`select * from public.import_sheet_application($1,$2,'Zeta','Ops','Applied'::public.application_stage,'2026-09-05','Referral','',false)`, [connection, importKey]);
  await db.query(`select * from public.import_sheet_application($1,$2,'Zeta','Ops','Applied'::public.application_stage,'2026-09-05','Referral','',true)`, [connection, importKey]);
  await db.query(`select * from public.import_sheet_application($1,$2,'Zeta','Ops','Applied'::public.application_stage,'2026-09-05','Referral','',true)`, [connection, importKey]);
  const responseEvents = await db.query(`select count(*)::int as count from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=$1 and e.event_type='employer_response'`, [importKey]);
  assert.equal(responseEvents.rows[0].count, 1);
}));

test('owner can record a follow_up_completed event that leaves the stage unchanged', async () => asUser(alice, async () => {
  const before = await db.query(`select stage from public.applications where id=$1`, [application]);
  const inserted = await db.query(`insert into public.application_events(application_id,event_status,event_type,source) values($1,'user_confirmed','follow_up_completed','manual') returning id`, [application]);
  assert.equal(inserted.rows.length, 1);
  const after = await db.query(`select stage from public.applications where id=$1`, [application]);
  assert.equal(before.rows[0].stage, after.rows[0].stage);
  const count = await db.query(`select count(*)::int as count from public.application_events where application_id=$1 and event_type='follow_up_completed'`, [application]);
  assert.equal(count.rows[0].count, 1);
}));

test('another user cannot record a follow_up_completed event for someone else', async () => asUser(bob, async () => {
  await assert.rejects(db.query(`insert into public.application_events(application_id,event_status,event_type,source) values($1,'user_confirmed','follow_up_completed','manual')`, [application]), /foreign key|row-level security/);
}));

test('RLS is enabled on import issues', async () => {
  const { rows } = await db.query(`select relrowsecurity from pg_class where oid = 'public.import_issues'::regclass`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].relrowsecurity);
});

test('owner can insert, read and delete their import issues', async () => asUser(alice, async () => {
  const inserted = await db.query(`insert into public.import_issues(sheet_connection_id,message) values($1,'Row 5 skipped: missing company') returning id`, [connection]);
  assert.equal(inserted.rows.length, 1);
  assert.equal((await db.query('select * from public.import_issues')).rows.length, 1);
  assert.equal((await db.query(`delete from public.import_issues where id=$1 returning id`, [inserted.rows[0].id])).rows.length, 1);
}));

test('another user sees zero import issues and cannot delete them', async () => asUser(bob, async () => {
  assert.equal((await db.query('select * from public.import_issues')).rows.length, 0);
  await assert.rejects(db.query(`insert into public.import_issues(sheet_connection_id,message) values($1,'Spoofed issue')`, [connection]), /foreign key|row-level security/);
}));

test('owner can delete their own rows in all tables', async () => asUser(alice, async () => {
  assert.equal((await db.query(`delete from public.application_events where application_id=$1 returning id`, [application])).rows.length, 1);
  assert.equal((await db.query(`delete from public.applications where id=$1 returning id`, [application])).rows.length, 1);
  assert.equal((await db.query(`delete from public.sheet_connections where id=$1 returning id`, [connection])).rows.length, 1);
}));

test('another user cannot delete owner rows', async () => asUser(bob, async () => {
  assert.equal((await db.query(`delete from public.application_events where application_id=$1 returning id`, [application])).rows.length, 0);
  assert.equal((await db.query(`delete from public.applications where id=$1 returning id`, [application])).rows.length, 0);
  assert.equal((await db.query(`delete from public.sheet_connections where id=$1 returning id`, [connection])).rows.length, 0);
}));
