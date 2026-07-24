import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { fetchShopInfo } from '@/lib/shopify/admin-api';
import { getShopifyRedirectUri, isShopifyOAuthConfigured } from '@/lib/shopify/config';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * GET /api/shopify/connection
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const redirectUri = getShopifyRedirectUri(new URL(request.url).origin);

    const { data: config, error } = await ctx.supabase
      .from('shopify_config')
      .select('shop_domain, status, connected_at, scopes, api_key, api_secret, access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load connection status' }, { status: 500 });
    }

    // Brands can always connect with their own custom-app Client ID/Secret.
    // Server-wide SHOPIFY_API_* remains an optional fallback for reconnect.
    const oauthAvailable = true;
    const hasAppCredentials = Boolean(config?.api_key && config?.api_secret);
    const apiKeyHint = config?.api_key
      ? `${String(config.api_key).slice(0, 6)}…${String(config.api_key).slice(-4)}`
      : null;

    if (!config?.shop_domain) {
      return NextResponse.json({
        configured: false,
        connected: false,
        oauth_available: oauthAvailable,
        has_app_credentials: false,
        api_key_hint: null,
        redirect_uri: redirectUri,
        env_app_fallback: isShopifyOAuthConfigured(),
        message:
          'Create a custom app in the Shopify Dev Dashboard, then enter Client ID, Client Secret, and shop domain to connect.',
      });
    }

    let shopName: string | null = null;
    let connected = config.status === 'connected';

    if (config.access_token) {
      try {
        const accessToken = decrypt(config.access_token);
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
      oauth_available: oauthAvailable,
      has_app_credentials: hasAppCredentials,
      api_key_hint: apiKeyHint,
      redirect_uri: redirectUri,
      env_app_fallback: isShopifyOAuthConfigured(),
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
