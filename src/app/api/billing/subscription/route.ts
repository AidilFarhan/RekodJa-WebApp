import { NextResponse } from 'next/server';
import { billingFailure, BillingError, authenticatedBillingUser } from '@/lib/billing/server';
import { manageSubscription } from '@/lib/billing/manage';
import { subscriptionRequest } from '@/lib/billing/presentation';

export const runtime = 'nodejs';

/* POST /api/billing/subscription — cancel, or schedule a plan change.
 * The server re-reads the live Stripe subscription, so a client can never
 * grant itself a plan change during a trial (409) or after a scheduled
 * cancellation. */
export async function POST(request: Request) {
  try {
    const user = await authenticatedBillingUser(request);
    const parsed = subscriptionRequest(await request.json().catch(() => null));
    if (!parsed) throw new BillingError(400, 'Choose a valid billing action.');
    const result = parsed.action === 'change_plan'
      ? await manageSubscription(user.id, 'change_plan', parsed.plan)
      : await manageSubscription(user.id, 'cancel');
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return billingFailure(error);
  }
}
