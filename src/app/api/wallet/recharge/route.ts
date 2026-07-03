import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchOrganizationMembership } from '@/lib/auth/organization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { computeGstPaise } from '@/lib/wallet/format';
import { getOrgPaymentConfig } from '@/lib/wallet/payment-config';
import { createRazorpayOrder } from '@/lib/wallet/razorpay';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as {
      amountPaise?: unknown;
    } | null;

    const baseAmountPaise = Number(body?.amountPaise);
    if (!Number.isFinite(baseAmountPaise) || baseAmountPaise < 100) {
      return NextResponse.json(
        { error: 'Minimum recharge amount is ₹1.00' },
        { status: 400 },
      );
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
      return NextResponse.json(
        { error: 'Payment gateway not configured' },
        { status: 503 },
      );
    }

    const paymentConfig = await getOrgPaymentConfig(organizationId);
    if (
      !paymentConfig?.isEnabled ||
      !paymentConfig.keyId ||
      !paymentConfig.keySecret
    ) {
      return NextResponse.json(
        { error: 'Recharge is not available. Contact Recover Agent support.' },
        { status: 503 },
      );
    }

    const gstRate = paymentConfig.gstRate ?? 0.18;
    const gstAmountPaise = computeGstPaise(baseAmountPaise, gstRate);
    const totalAmountPaise = baseAmountPaise + gstAmountPaise;

    const db = supabaseAdmin();
    const { data: recharge, error: insertErr } = await db
      .from('wallet_recharges')
      .insert({
        account_id: ctx.accountId,
        base_amount_paise: baseAmountPaise,
        gst_amount_paise: gstAmountPaise,
        total_amount_paise: totalAmountPaise,
        status: 'pending',
        provider: 'razorpay',
        created_by_user_id: ctx.userId,
      })
      .select('id')
      .single();

    if (insertErr || !recharge) {
      console.error('[POST /api/wallet/recharge]', insertErr);
      return NextResponse.json({ error: 'Failed to create recharge' }, { status: 500 });
    }

    const order = await createRazorpayOrder({
      keyId: paymentConfig.keyId,
      keySecret: paymentConfig.keySecret,
      amountPaise: totalAmountPaise,
      receipt: `rc_${recharge.id.slice(0, 8)}`,
      notes: {
        recharge_id: recharge.id,
        account_id: ctx.accountId,
      },
    });

    await db
      .from('wallet_recharges')
      .update({ provider_order_id: order.id })
      .eq('id', recharge.id);

    return NextResponse.json({
      rechargeId: recharge.id,
      orderId: order.id,
      keyId: paymentConfig.keyId,
      baseAmountPaise,
      gstAmountPaise,
      totalAmountPaise,
      gstRate,
      currency: 'INR',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
