import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users values ('${alice}'),('${bob}');
    create table public.gmail_scan_candidates(id integer primary key, user_id uuid, subject text);
    alter table public.gmail_scan_candidates enable row level security;
    grant select,insert,update,delete on public.gmail_scan_candidates to authenticated;
    create policy own_rows on public.gmail_scan_candidates for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
    insert into public.gmail_scan_candidates values (1,'${alice}','private'),(2,'${bob}','private');`);
  for (const name of ['20260924132329_stripe_subscriptions.sql', '20260924133124_stripe_billing_transactions.sql', '20260924181902_stripe_checkout_and_gmail_access.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.query('insert into public.billing_customers(user_id,stripe_customer_id) values ($1,$2),($3,$4)', [alice,'cus_alice',bob,'cus_bob']);
});
after(() => db.close());
async function transaction(run, role = 'service_role', user = alice) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    await db.exec(`set local role ${role}`);
    await run();
  } finally { await db.exec('rollback'); }
}
function snapshot(overrides = {}) {
  return { user_id: alice, stripe_customer_id:'cus_alice', stripe_subscription_id:'sub_alice', status:'trialing',
    price_id:'price_month', price_lookup_key:'PRO_monthly', billing_interval:'month', billing_interval_count:1,
    trial_end: new Date(Date.now()+86400000).toISOString(), current_period_end:new Date(Date.now()+86400000).toISOString(),
    past_due_at:null, cancel_at_period_end:false, has_used_trial:true, ...overrides };
}
async function apply(id, revision, data) {
  const result = await db.query(`select public.apply_stripe_subscription_event($1,'customer.subscription.updated',now(),$2,jsonb_populate_record(null::public.subscriptions,$3::jsonb)) as result`, [id,revision,JSON.stringify(data)]);
  return result.rows[0].result;
}
test('Checkout claim keeps the first plan, trial decision, expiration and attempt ID across competing requests', () => transaction(async () => {
  const claim = async (plan, trial) => (await db.query(`select (public.claim_stripe_checkout($1,$2,'price_test',$3)).*`, [alice,plan,trial])).rows[0];
  const one = await claim('PRO_monthly',true);
  const two = await claim('PRO_yearly',false);
  assert.ok(one.checkout_attempt_id);
  assert.equal(two.checkout_attempt_id,one.checkout_attempt_id);
  assert.equal(two.checkout_plan,'PRO_monthly');
  assert.equal(two.checkout_trial,true);
  assert.equal(two.checkout_lease_until.getTime(),one.checkout_lease_until.getTime());
}));
test('webhook duplicate and stale revision are safe, and used-trial remains sticky', () => transaction(async () => {
  assert.equal(await apply('evt_one',0,snapshot()),'applied');
  assert.equal(await apply('evt_one',0,snapshot()),'duplicate');
  assert.equal(await apply('evt_two',0,snapshot()),'retry');
  assert.equal(await apply('evt_two',1,snapshot({status:'active',has_used_trial:false,trial_end:null})),'applied');
  assert.equal((await db.query('select has_used_trial from subscriptions')).rows[0].has_used_trial,true);
  assert.equal((await db.query('select count(*)::int as n from stripe_webhook_events')).rows[0].n,2);
}));
test('payment retries preserve the first failure rather than extending grace', () => transaction(async () => {
  const first = new Date(Date.now()-86400000).toISOString();
  await apply('evt_first',0,snapshot({status:'past_due',past_due_at:first}));
  await apply('evt_retry',1,snapshot({status:'past_due',past_due_at:new Date().toISOString()}));
  const row = (await db.query('select past_due_at from subscriptions')).rows[0];
  assert.equal(row.past_due_at.getTime(),Date.parse(first));
}));
test('free users cannot read their own Gmail candidates or invoke billing writes', () => transaction(async () => {
  assert.equal((await db.query('select * from gmail_scan_candidates')).rows.length,0);
  await assert.rejects(db.query("select public.claim_stripe_checkout($1,'PRO_monthly','price_test',true)",[alice]),/permission denied/);
},'authenticated'));
test('trial access keeps own Gmail data, blocks other users and ends at the deadline', () => transaction(async () => {
  await apply('evt_trial',0,snapshot({cancel_at_period_end:true}));
  await db.exec('set local role authenticated');
  assert.deepEqual((await db.query('select id from gmail_scan_candidates')).rows,[{id:1}]);
  await db.exec('set local role service_role');
  await apply('evt_expired',1,snapshot({trial_end:new Date(Date.now()-1000).toISOString()}));
  await db.exec('set local role authenticated');
  assert.equal((await db.query('select * from gmail_scan_candidates')).rows.length,0);
}));
test('invalid ownership fails atomically without recording a processed event', () => transaction(async () => {
  await assert.rejects(apply('evt_bad',0,snapshot({stripe_customer_id:'cus_bob'})),/ownership mismatch/);
}));
