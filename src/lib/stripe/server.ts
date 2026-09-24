import 'server-only';
import Stripe from 'stripe';
import { accountFor, billingEnvironmentWithKey } from '../billing/test-environment.mjs';

let client: Stripe | undefined;

/** A Stripe client for this deployment, or a throw when there is none.
 *
 * The key must match the environment: a test key outside the Test project, a
 * live key on a developer machine, or a key belonging to another account are
 * all refused rather than quietly acted on.
 */
export function stripeServer(): Stripe {
  const environment = billingEnvironmentWithKey(process.env);
  if (!environment) {
    throw new Error('A Stripe secret key matching this environment is required.');
  }
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY as string);
  return client;
}

export async function verifiedStripe(): Promise<Stripe> {
  const stripe = stripeServer();
  // A key prefix does not identify an account: any other Stripe account's key
  // satisfies it. Each environment therefore pins its own account id, because a
  // Stripe Sandbox is an account of its own and does not share the live id.
  const expected = accountFor(process.env);
  if (!expected) throw new Error('Billing requires a recognised environment.');
  const account = await stripe.accounts.retrieveCurrent();
  if (account.id !== expected) throw new Error('Wrong Stripe account.');
  return stripe;
}
