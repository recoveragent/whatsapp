import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchRecentOrderPayloads } from '@/lib/shopify/admin-api';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await supabaseAdmin()
      .from('shopify_config')
      .select('shop_domain, access_token, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.status !== 'connected' || !data.access_token) {
      return NextResponse.json(
        { error: 'Connect Shopify to browse recent orders.' },
        { status: 409 }
      );
    }
    const orders = await fetchRecentOrderPayloads(
      data.shop_domain,
      decrypt(data.access_token)
    );
    return NextResponse.json(
      { orders },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
