import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { loadTestEnv } from './dev-test.mjs';
import { SANDBOX_ACCOUNT, SANDBOX_CARDS_CONFIG_NAME, SANDBOX_PORTAL } from '../src/lib/billing/plans.ts';

// Read-only unless this exact, explicit setup switch is supplied. Never prints
// provider exceptions or credentials. Uses neither inherited keys nor .env.local.
let stage = 'TEST_ENV';
try {
  const configure = process.argv.slice(2).join(' ') === '--configure-payment-methods';
  if (process.argv.length > 2 && !configure) throw new Error('Invalid arguments');
  const env = await loadTestEnv(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  stage = 'STRIPE_KEY_PRESENT';
  if (!env.STRIPE_SECRET_KEY) throw new Error('Missing key');
  console.log('STRIPE_KEY_PRESENT: PASS');
  stage = 'SANDBOX_ACCOUNT';
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  if ((await stripe.accounts.retrieveCurrent()).id !== SANDBOX_ACCOUNT) throw new Error('Wrong account');
  console.log('SANDBOX_ACCOUNT: PASS');
  stage = 'CARDS_ONLY_CONFIGURATION';
  const configs = await stripe.paymentMethodConfigurations.list({ limit: 100 });
  let config = configs.data.find(item => item.name === SANDBOX_CARDS_CONFIG_NAME && item.active);
  if (configs.has_more) throw new Error('Review configuration pagination');
  if (configure && !config) {
    config = await stripe.paymentMethodConfigurations.create({
      name: SANDBOX_CARDS_CONFIG_NAME, card: { display_preference: { preference: 'on' } },
      apple_pay: { display_preference: { preference: 'off' } },
      google_pay: { display_preference: { preference: 'off' } },
      link: { display_preference: { preference: 'off' } },
      alipay: { display_preference: { preference: 'off' } },
      fpx: { display_preference: { preference: 'off' } },
      grabpay: { display_preference: { preference: 'off' } },
    }, { idempotencyKey: 'rekodja-sandbox-cards-config-v1' });
  }
  if (!config || config.livemode || config.card?.display_preference.value !== 'on') throw new Error('Not configured');
  for (const [name,value] of Object.entries(config)) {
    if (name !== 'card' && value && typeof value === 'object' && value.display_preference?.value === 'on') throw new Error('Extra payment method');
  }
  console.log('CARDS_ONLY_CONFIGURATION: PASS');
  stage = 'PORTAL_POLICY';
  if (configure) await stripe.billingPortal.configurations.update(SANDBOX_PORTAL, {
    features: { payment_method_update: { enabled:true, payment_method_configuration:config.id } },
  });
  const portal = await stripe.billingPortal.configurations.retrieve(SANDBOX_PORTAL);
  if (portal.livemode || !portal.active || portal.features.subscription_update.enabled ||
      portal.features.subscription_update.trial_update_behavior !== 'continue_trial' ||
      portal.features.subscription_cancel.mode !== 'at_period_end' ||
      portal.features.payment_method_update.payment_method_configuration !== config.id) throw new Error('Unsafe portal');
  console.log('PORTAL_POLICY: PASS');
  console.log(`WEBHOOK_SECRET_PRESENT: ${env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_') ? 'PASS' : 'FAIL'}`);
} catch {
  console.log(`${stage}: FAIL`);
  console.log('BILLING_SANDBOX_CHECK: FAIL');
  process.exitCode = 1;
}
