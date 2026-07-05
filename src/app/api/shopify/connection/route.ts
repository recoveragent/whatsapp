import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchShopInfo } from '@/lib/shopify/admin-api';
import { isShopifyOAuthConfigured } from '@/lib/shopify/config';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * GET /api/shopify/connection
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: config, error } = await ctx.supabase
      .from('shopify_config')
      .select('shop_domain, status, connected_at, scopes')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load connection status' }, { status: 500 });
    }

    if (!config?.shop_domain) {
      return NextResponse.json({
        configured: false,
        connected: false,
        oauth_available: isShopifyOAuthConfigured(),
        message: 'Connect your Shopify store to send order and checkout messages.',
      });
    }

    const { data: fullRow } = await ctx.supabase
      .from('shopify_config')
      .select('access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    let shopName: string | null = null;
    let connected = config.status === 'connected';

    if (fullRow?.access_token) {
      try {
        const accessToken = decrypt(fullRow.access_token);
        const shop = await fetchShopInfo(config.shop_domain, accessToken);
        shopName = shop.name;
        connected = true;
      } catch {
        connected = false;
      }
    }

    return NextResponse.json({
      configured: true,
      connected,
      needs_reconnect: !connected,
      oauth_available: isShopifyOAuthConfigured(),
      shop_domain: config.shop_domain,
      shop_name: shopName,
      connected_at: config.connected_at,
      scopes: config.scopes,
      message: connected
        ? 'Webhooks are registered. Enable campaigns below to start sending messages.'
        : 'Your Shopify app may have been uninstalled or the access token expired. Reconnect to restore automations.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/shopify/connection
 *
 * Removes the stored Shopify OAuth credentials for this workspace so
 * the admin can connect a fresh app install.
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');

    const { error } = await ctx.supabase
      .from('shopify_config')
      .delete()
      .eq('account_id', ctx.accountId);

    if (error) {
      return NextResponse.json({ error: 'Failed to disconnect Shopify' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
