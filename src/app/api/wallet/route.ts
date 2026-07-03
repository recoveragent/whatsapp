import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchOrganizationMembership } from '@/lib/auth/organization';
import {
  getOrgPaymentConfig,
  toPublicPaymentConfig,
} from '@/lib/wallet/payment-config';
import type { MessagePricingRow } from '@/lib/wallet/types';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const { data: wallet } = await ctx.supabase
      .from('account_wallets')
      .select('balance_paise, currency')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const { data: pricing } = await ctx.supabase
      .from('account_message_pricing')
      .select('category, price_paise')
      .eq('account_id', ctx.accountId);

    let paymentEnabled = false;
    let gstRate = 0.18;

    const { data: accountRow } = await ctx.supabase
      .from('accounts')
      .select('organization_id')
      .eq('id', ctx.accountId)
      .maybeSingle();

    const organizationId =
      ctx.organizationId ??
      (accountRow?.organization_id as string | undefined) ??
      (await fetchOrganizationMembership(ctx.supabase, ctx.userId))?.organizationId;

    if (organizationId) {
      const config = await getOrgPaymentConfig(organizationId);
      paymentEnabled = Boolean(config?.isEnabled && config.keyId && config.hasKeySecret);
      gstRate = config?.gstRate ?? 0.18;
    }

    const pricingRows: MessagePricingRow[] = (pricing ?? []).map((r) => ({
      category: r.category as MessagePricingRow['category'],
      pricePaise: Number(r.price_paise ?? 0),
    }));

    return NextResponse.json({
      balancePaise: Number(wallet?.balance_paise ?? 0),
      currency: (wallet?.currency as string) ?? 'INR',
      pricing: pricingRows,
      rechargeEnabled: paymentEnabled,
      gstRate,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
