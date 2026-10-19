import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resumeFlowPendingExecutions } from '@/lib/flows/engine';
import {
  cashfreeCredentials,
  reconcilePayment,
  type CollectionRow,
} from '@/lib/payments/collect-payment';
import { validCashfreeSignature } from '@/lib/payments/cashfree';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const { accountId } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(accountId))
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const db = supabaseAdmin();
    const credentials = await cashfreeCredentials(db, accountId);
    const raw = await request.text();
    if (
      !validCashfreeSignature(
        raw,
        request.headers.get('x-webhook-timestamp') ?? '',
        request.headers.get('x-webhook-signature') ?? '',
        credentials.client_secret
      )
    )
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (body.type !== 'PAYMENT_LINK_EVENT')
      return NextResponse.json({ received: true });
    const linkId = body.data?.link_id;
    if (typeof linkId !== 'string')
      return NextResponse.json(
        { error: 'Missing payment link' },
        { status: 400 }
      );
    const { data, error } = await db
      .from('flow_payment_requests')
      .select('*')
      .eq('account_id', accountId)
      .eq('config->>provider', 'cashfree')
      .eq('provider_link_id', linkId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    if (data) {
      await reconcilePayment(db, data as CollectionRow);
      await resumeFlowPendingExecutions(data.flow_run_id);
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: 'Payment webhook could not be processed; retry later.' },
      { status: 503 }
    );
  }
}
