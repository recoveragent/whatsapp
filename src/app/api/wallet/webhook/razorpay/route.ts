import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOrgPaymentConfig } from '@/lib/wallet/payment-config';
import { verifyRazorpayWebhookSignature } from '@/lib/wallet/razorpay';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') ?? '';

  let payload: {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, string> } };
    };
  };

  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = supabaseAdmin();

  const orderId = payload.payload?.payment?.entity?.order_id;
  const paymentId = payload.payload?.payment?.entity?.id;
  const rechargeId = payload.payload?.payment?.entity?.notes?.recharge_id;

  if (!orderId || !paymentId) {
    return NextResponse.json({ received: true });
  }

  let recharge: { id: string; account_id: string } | null = null;
  if (rechargeId) {
    const { data } = await db
      .from('wallet_recharges')
      .select('id, account_id')
      .eq('id', rechargeId)
      .maybeSingle();
    recharge = data;
  }
  if (!recharge) {
    const { data } = await db
      .from('wallet_recharges')
      .select('id, account_id')
      .eq('provider_order_id', orderId)
      .maybeSingle();
    recharge = data;
  }

  if (!recharge) {
    return NextResponse.json({ received: true });
  }

  const { data: account } = await db
    .from('accounts')
    .select('organization_id')
    .eq('id', recharge.account_id)
    .maybeSingle();

  if (!account?.organization_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const config = await getOrgPaymentConfig(account.organization_id as string);
  if (config?.webhookSecret) {
    const valid = verifyRazorpayWebhookSignature({
      body: rawBody,
      signature,
      webhookSecret: config.webhookSecret,
    });
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  if (payload.event === 'payment.captured' || payload.event === 'payment.authorized') {
    const { error } = await db.rpc('credit_wallet_for_recharge', {
      p_recharge_id: recharge.id,
      p_payment_id: paymentId,
    });
    if (error) {
      console.error('[webhook/razorpay] credit failed:', error);
      return NextResponse.json({ error: 'Credit failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
