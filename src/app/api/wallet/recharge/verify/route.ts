import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifyRazorpayPaymentSignature } from '@/lib/wallet/razorpay';
import { getOrgPaymentConfig } from '@/lib/wallet/payment-config';
import { fetchOrganizationMembership } from '@/lib/auth/organization';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as {
      rechargeId?: unknown;
      razorpay_order_id?: unknown;
      razorpay_payment_id?: unknown;
      razorpay_signature?: unknown;
    } | null;

    const rechargeId = typeof body?.rechargeId === 'string' ? body.rechargeId : '';
    const orderId =
      typeof body?.razorpay_order_id === 'string' ? body.razorpay_order_id : '';
    const paymentId =
      typeof body?.razorpay_payment_id === 'string' ? body.razorpay_payment_id : '';
    const signature =
      typeof body?.razorpay_signature === 'string' ? body.razorpay_signature : '';

    if (!rechargeId || !orderId || !paymentId || !signature) {
      return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { data: recharge } = await db
      .from('wallet_recharges')
      .select('*')
      .eq('id', rechargeId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!recharge) {
      return NextResponse.json({ error: 'Recharge not found' }, { status: 404 });
    }

    if (recharge.provider_order_id !== orderId) {
      return NextResponse.json({ error: 'Order mismatch' }, { status: 400 });
    }

    let organizationId = ctx.organizationId;
    if (!organizationId) {
      const { data: accountRow } = await ctx.supabase
        .from('accounts')
        .select('organization_id')
        .eq('id', ctx.accountId)
        .maybeSingle();
      organizationId =
        (accountRow?.organization_id as string | undefined) ??
        (await fetchOrganizationMembership(ctx.supabase, ctx.userId))?.organizationId;
    }
    if (!organizationId) {
      return NextResponse.json({ error: 'Payment config not found' }, { status: 503 });
    }

    const paymentConfig = await getOrgPaymentConfig(organizationId);
    if (!paymentConfig?.keySecret) {
      return NextResponse.json({ error: 'Payment config not found' }, { status: 503 });
    }

    const valid = verifyRazorpayPaymentSignature({
      orderId,
      paymentId,
      signature,
      keySecret: paymentConfig.keySecret,
    });

    if (!valid) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    const { data: result, error } = await db.rpc('credit_wallet_for_recharge', {
      p_recharge_id: rechargeId,
      p_payment_id: paymentId,
    });

    if (error) {
      console.error('[POST /api/wallet/recharge/verify]', error);
      return NextResponse.json({ error: 'Failed to credit wallet' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      balancePaise: Number((result as { balance_paise?: number })?.balance_paise ?? 0),
      alreadyPaid: Boolean((result as { already_paid?: boolean })?.already_paid),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
