import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripeServer } from '@/lib/stripe/server';
import { processBillingEvent } from '@/lib/billing/webhook';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret?.startsWith('whsec_')) return NextResponse.json({ error: 'Webhook is not configured.' }, { status: 503 });
  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
  let event: Stripe.Event;
  try {
    // Signature verification must use the untouched body, never parsed JSON.
    event = stripeServer().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook.' }, { status: 400 });
  }
  try {
    const result = await processBillingEvent(event);
    return NextResponse.json({ received: true, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Returning non-2xx makes Stripe retry; do not acknowledge failed writes.
    return NextResponse.json({ error: 'Webhook processing failed.' }, { status: 500 });
  }
}
