import 'server-only';
import Stripe from 'stripe';
import { assertTestEnvironment } from '../billing/test-environment.mjs';
import { SANDBOX_ACCOUNT } from '../billing/plans';

let client: Stripe | undefined;

export function stripeServer(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !key.startsWith('sk_test_')) {
    throw new Error('A Stripe Sandbox secret key is required.');
  }
  assertTestEnvironment(process.env);
  client ??= new Stripe(key);
  return client;
}

export async function verifiedStripe(): Promise<Stripe> {
  const stripe = stripeServer();
  // A sk_test prefix alone does not identify the intended Sandbox account.
  const account = await stripe.accounts.retrieveCurrent();
  if (account.id !== SANDBOX_ACCOUNT) throw new Error('Wrong Stripe Sandbox account.');
  return stripe;
}
