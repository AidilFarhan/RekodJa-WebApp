// Print the Stripe objects this app needs, for the mode the key belongs to.
//
// Run this yourself, with the key in your own shell. It only READS from Stripe:
// it creates nothing and charges nobody. Object ids and configuration names are
// identifiers, not secrets, and the key itself is never printed.
//
//   $env:STRIPE_SECRET_KEY = 'sk_live_...'
//   node scripts/billing-objects.mjs
//
// Use the Sandbox key to check the Test setup, or the live key to gather the
// values for Vercel. The mode is taken from the key, so there is no flag to get
// wrong.
import Stripe from 'stripe';
import { PLANS } from '../src/lib/billing/plans.ts';
import { LIVE_ACCOUNT, SANDBOX_ACCOUNT } from '../src/lib/billing/test-environment.mjs';

const key = process.env.STRIPE_SECRET_KEY ?? '';
// Secret keys (sk_) and restricted keys (rk_) are both accepted by the app.
const mode = /^(?:sk|rk)_live_/.test(key) ? 'live' : /^(?:sk|rk)_test_/.test(key) ? 'test' : null;

if (!mode) {
  console.log('Set STRIPE_SECRET_KEY to a Stripe secret or restricted key before running this.');
  process.exit(1);
}

const stripe = new Stripe(key);
const live = mode === 'live';

console.log(`mode: ${mode}`);
// The app pins one account per mode, and a Stripe Sandbox has its own id. A key
// from the wrong account would work here but be refused by the app, so say so.
const account = await stripe.accounts.retrieveCurrent();
const expected = live ? LIVE_ACCOUNT : SANDBOX_ACCOUNT;
const accountNote = account.id === expected
  ? '(the account the app expects)'
  : `(WRONG ACCOUNT — the app expects ${expected})`;
console.log(`account: ${account.id}  ${accountNote}`);
console.log('');

// The three plan prices, checked against what the code expects.
for (const [lookupKey, plan] of Object.entries(PLANS)) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 2 });
  const price = found.data[0];
  if (!price) {
    console.log(`${lookupKey}: MISSING — create a price with lookup_key ${lookupKey}`);
    continue;
  }
  const product = typeof price.product === 'string' ? price.product : price.product.id;
  const matches = price.livemode === live && price.unit_amount === plan.amount &&
    price.currency === 'myr' && price.recurring?.interval === plan.interval &&
    price.recurring?.interval_count === plan.count;
  console.log(`${lookupKey}: ${matches ? 'OK   ' : 'CHECK'} ${price.id}  ${price.unit_amount} ${price.currency} / ${price.recurring?.interval_count} ${price.recurring?.interval}  product ${product}`);
}

console.log('');
// Payment method configurations in this account. The app looks its own one up
// by NAME, so that name is the value Vercel needs. Without --create this only
// reports. With --create, a cards-only configuration is created under whatever
// name is in STRIPE_CARDS_CONFIG_NAME, which saves hunting through the
// dashboard for a page that does not show ids anyway.
const create = process.argv.includes('--create');
const wanted = (process.env.STRIPE_CARDS_CONFIG_NAME ?? '').trim();
const configs = await stripe.paymentMethodConfigurations.list({ limit: 100 });
const described = configs.data.map(item => {
  const others = Object.entries(item)
    .filter(([name, value]) => name !== 'card' && value && typeof value === 'object' &&
      'display_preference' in value && value.display_preference.value === 'on')
    .map(([name]) => name);
  return { item, others, cardsOnly: item.card?.display_preference.value === 'on' && others.length === 0 };
});
if (described.length === 0) console.log('payment method configurations: none found');
for (const { item, others, cardsOnly } of described) {
  console.log(`configuration: name="${item.name}"  id=${item.id}  livemode=${item.livemode}  cardsOnly=${cardsOnly}  otherMethods=[${others.join(', ')}]`);
}
const ready = described.find(entry => entry.cardsOnly && entry.item.livemode === live && entry.item.active);
if (ready) {
  console.log(`usable cards-only configuration: "${ready.item.name}"`);
} else if (create && wanted) {
  const created = await stripe.paymentMethodConfigurations.create({
    name: wanted,
    card: { display_preference: { preference: 'on' } },
  });
  console.log(`configuration: CREATED name="${created.name}"  id=${created.id}  livemode=${created.livemode}`);
  console.log(`Now use the same name in Vercel:  STRIPE_CARDS_CONFIG_NAME=${created.name}`);
} else if (create) {
  console.log('Nothing created: set STRIPE_CARDS_CONFIG_NAME to the name you want, then run again with --create.');
} else {
  console.log('No usable cards-only configuration for this mode. Add --create to make one.');
}

console.log('');
const portals = await stripe.billingPortal.configurations.list({ limit: 10 });
if (portals.data.length === 0) console.log('portal configuration: none found — configure the customer portal first');
for (const item of portals.data) {
  console.log(`portal configuration: id=${item.id}  livemode=${item.livemode}`);
}

console.log('');
console.log(`Values for Vercel (${mode}):`);
console.log('  STRIPE_CARDS_CONFIG_NAME=<the name of the configuration with ONLY cards enabled>');
for (const item of portals.data) console.log(`  STRIPE_PORTAL_CONFIGURATION=${item.id}`);
