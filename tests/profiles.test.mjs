import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
before(async () => {
  // Supabase supplies these roles and auth schema. The actual migration below is unmodified.
  await db.exec(`create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202609170001_profiles.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180005_profiles_name_confirmed.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180006_empty_name_trigger.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202609180007_profiles_insert_grant.sql', import.meta.url), 'utf8'));
  await db.query(`insert into auth.users values ($1, '{"full_name":"Alice"}'), ($2, '{"full_name":"Bob"}')`, [alice, bob]);
});
after(() => db.close());
async function asUser(id, callback, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id]);
    await db.exec(`set local role ${role}`);
    return await callback();
  } finally { await db.exec('rollback'); }
}
test('RLS is enabled on profiles', async () => {
  const { rows } = await db.query(`select relrowsecurity from pg_class where oid = 'public.profiles'::regclass`);
  assert.equal(rows[0].relrowsecurity, true);
});
test('auth insert creates exactly one profile with an empty name', async () => {
  const { rows } = await db.query('select display_name from public.profiles where id = $1', [alice]);
  assert.deepEqual(rows, [{ display_name: '' }]);
});
test('Alice sees only herself even without a client-side filter', async () => asUser(alice, async () => {
  const { rows } = await db.query('select id from public.profiles');
  assert.deepEqual(rows, [{ id: alice }]);
}));
test('Alice cannot read Bob directly', async () => asUser(alice, async () => {
  assert.equal((await db.query('select * from public.profiles where id = $1', [bob])).rows.length, 0);
}));
test('Bob sees only his own profile', async () => asUser(bob, async () => {
  assert.deepEqual((await db.query('select id from public.profiles')).rows, [{ id: bob }]);
}));
test('owner can edit display name', async () => asUser(alice, async () => {
  assert.deepEqual((await db.query(`update public.profiles set display_name = 'Updated' where id = $1 returning display_name`, [alice])).rows, [{ display_name: 'Updated' }]);
}));
test('name_confirmed defaults to false and owner can confirm it', async () => asUser(alice, async () => {
  assert.deepEqual((await db.query('select name_confirmed from public.profiles where id = $1', [alice])).rows, [{ name_confirmed: false }]);
  assert.deepEqual((await db.query(`update public.profiles set name_confirmed = true where id = $1 returning name_confirmed`, [alice])).rows, [{ name_confirmed: true }]);
}));

test('owner can upsert a profile with name_confirmed after deletion', async () => asUser(alice, async () => {
  await db.query('delete from public.profiles where id = $1', [alice]);
  const { rows } = await db.query(`insert into public.profiles(id, display_name, name_confirmed) values($1, 'Nayo', true) on conflict (id) do update set display_name = excluded.display_name, name_confirmed = excluded.name_confirmed returning display_name, name_confirmed`, [alice]);
  assert.deepEqual(rows, [{ display_name: 'Nayo', name_confirmed: true }]);
}));
test('Alice cannot update Bob', async () => asUser(alice, async () => {
  assert.equal((await db.query(`update public.profiles set display_name = 'Hacked' where id = $1 returning id`, [bob])).rows.length, 0);
}));
test('user cannot reassign profile ownership', async () => asUser(alice, async () => {
  await assert.rejects(db.query('update public.profiles set id = $1 where id = $2', [bob, alice]), /permission denied|row-level security/);
}));
test('user cannot insert a profile for another identity', async () => asUser(alice, async () => {
  await assert.rejects(db.query(`insert into public.profiles(id) values ('33333333-3333-4333-8333-333333333333')`), /row-level security/);
}));
test('anonymous users cannot read profiles', async () => asUser('', async () => {
  await assert.rejects(db.query('select * from public.profiles'), /permission denied/);
}, 'anon'));
test('database rejects oversized names', async () => asUser(alice, async () => {
  await assert.rejects(db.query('update public.profiles set display_name = $1 where id = $2', ['a'.repeat(81), alice]), /check constraint/);
}));
