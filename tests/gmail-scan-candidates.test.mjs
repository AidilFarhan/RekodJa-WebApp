import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

before(async () => {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202609180001_applications_and_sheets.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609200001_gmail_scan_candidates.sql', import.meta.url), 'utf8'));
  await db.query(`insert into auth.users values ($1, '{}'), ($2, '{}')`, [alice, bob]);
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

test('RLS is enabled on gmail_scan_candidates', async () => {
  const { rows } = await db.query(`select relrowsecurity from pg_class where oid = 'public.gmail_scan_candidates'::regclass`);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].relrowsecurity);
});

test('owner can create, read, update and delete their own candidate', async () => asUser(alice, async () => {
  const inserted = await db.query(`insert into public.gmail_scan_candidates(message_id, thread_id, suggested_company) values('m1','t1','Acme') returning id`);
  assert.equal(inserted.rows.length, 1);
  assert.equal((await db.query('select * from public.gmail_scan_candidates')).rows.length, 1);
  assert.equal((await db.query(`update public.gmail_scan_candidates set review_state='confirmed' where message_id='m1' returning id`)).rows.length, 1);
  assert.equal((await db.query(`delete from public.gmail_scan_candidates where message_id='m1' returning id`)).rows.length, 1);
  assert.equal((await db.query('select * from public.gmail_scan_candidates')).rows.length, 0);
}));

test('one candidate per message id per user is enforced', async () => asUser(alice, async () => {
  await db.query(`insert into public.gmail_scan_candidates(message_id) values('dup1')`);
  await assert.rejects(db.query(`insert into public.gmail_scan_candidates(message_id) values('dup1')`), /unique/);
}));

test('another user sees zero candidates and cannot read, modify, delete or spoof-insert them', async () => asUser(bob, async () => {
  // Seed an owner candidate inside this transaction, then switch to Bob.
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [alice]);
  const seeded = await db.query(`insert into public.gmail_scan_candidates(message_id, suggested_company) values('owned-1','Acme') returning id`);
  assert.equal(seeded.rows.length, 1);
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [bob]);
  assert.equal((await db.query('select * from public.gmail_scan_candidates')).rows.length, 0);
  assert.equal((await db.query(`update public.gmail_scan_candidates set review_state='dismissed' returning id`)).rows.length, 0);
  assert.equal((await db.query(`delete from public.gmail_scan_candidates returning id`)).rows.length, 0);
  await assert.rejects(
    db.query(`insert into public.gmail_scan_candidates(user_id, message_id) values($1, 'spoof')`, [alice]),
    /row-level security|insufficient_privilege/,
  );
}));

test('matched_application_id foreign key resolves only to the owner application', async () => asUser(bob, async () => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [alice]);
  await db.query(`insert into public.applications(id, company, role, stage, date_applied) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Acme','Engineer','Applied','2026-09-01')`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [bob]);
  await assert.rejects(
    db.query(`insert into public.gmail_scan_candidates(user_id, message_id, matched_application_id) values($1, 'fk-spoof', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`, [alice]),
    /row-level security|insufficient_privilege/,
  );
}));
