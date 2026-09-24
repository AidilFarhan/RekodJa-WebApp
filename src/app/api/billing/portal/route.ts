import { NextResponse } from 'next/server';
import { authenticatedBillingUser, billingFailure } from '@/lib/billing/server';
import { createPortal } from '@/lib/billing/manage';

export const runtime = 'nodejs';

/* POST /api/billing/portal — open the Stripe Customer Portal.
 * Every portal guard (Sandbox account, configuration ID, cards-only payment
 * configuration, cancellation mode, trial behavior, customer ownership) is
 * re-verified server-side in createPortal before a session is created. */
export async function POST(request: Request) {
  try {
    const user = await authenticatedBillingUser(request);
    const url = await createPortal(user.id);
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return billingFailure(error);
  }
}
