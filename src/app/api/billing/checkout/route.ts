import { NextResponse } from 'next/server';
import { authenticatedBillingUser, billingFailure, BillingError } from '@/lib/billing/server';
import { createCheckout } from '@/lib/billing/checkout';
import { isPlanKey } from '@/lib/billing/plans';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await authenticatedBillingUser(request);
    const body = await request.json().catch(() => null);
    if (!isPlanKey(body?.plan)) throw new BillingError(400, 'Choose a valid plan.');
    const url = await createCheckout(user.id, body.plan);
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return billingFailure(error); }
}
