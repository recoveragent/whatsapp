import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { loadWooCommerceCredentials } from '@/lib/woocommerce/load-config';
import { fetchRecentOrderPayloads } from '@/lib/woocommerce/admin-api';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const config = await loadWooCommerceCredentials(
      supabaseAdmin(),
      ctx.accountId
    );
    if (!config) {
      return NextResponse.json(
        { error: 'Connect WooCommerce to browse recent orders.' },
        { status: 409 }
      );
    }
    const orders = await fetchRecentOrderPayloads(
      config.storeUrl,
      config.consumerKey,
      config.consumerSecret
    );
    return NextResponse.json(
      { orders },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
