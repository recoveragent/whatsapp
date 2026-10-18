import { resumeFlowPendingExecutions } from '@/lib/flows/engine';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  paymentCredentials,
  reconcilePayment,
  type CollectionRow,
} from '@/lib/payments/collect-payment';
import { validPaymentSignature } from '@/lib/payments/razorpay';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(accountId))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const db = supabaseAdmin();
  try {
    const credentials = await paymentCredentials(db, accountId);
    const raw = await request.text();
    if (
      !validPaymentSignature(
        raw,
        request.headers.get('x-razorpay-signature') ?? '',
        credentials.webhook_secret
      )
    )
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (
      ![
        'payment_link.paid',
        'payment_link.expired',
        'payment_link.cancelled',
      ].includes(body.event)
    )
      return NextResponse.json({ received: true });
    const linkId = body.payload?.payment_link?.entity?.id;
    if (typeof linkId !== 'string')
      return NextResponse.json(
        { error: 'Missing payment link' },
        { status: 400 }
      );
    const { data, error } = await db
      .from('flow_payment_requests')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider_link_id', linkId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    if (data) {
      await reconcilePayment(db, data as CollectionRow);
      await resumeFlowPendingExecutions(data.flow_run_id);
    }
    // The flows cron recovers queued continuations if this immediate drain fails.
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: 'Payment webhook could not be processed; retry later.' },
      { status: 503 }
    );
  }
}
