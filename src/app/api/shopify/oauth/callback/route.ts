import { NextResponse } from 'next/server';

import { exchangeOAuthCode } from '@/lib/shopify/admin-api';
import {
  getShopifyApiKey,
  getShopifyApiSecret,
  getShopifySettingsOrigin,
  getShopifyWebhookUrl,
  isShopifyOAuthConfigured,
} from '@/lib/shopify/config';
import { consumeOAuthState, persistShopifyConfig } from '@/lib/shopify/persist-config';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

function settingsRedirect(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL(`${origin}/settings`);
  url.searchParams.set('tab', 'shopify');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url.toString());
}

/**
 * GET /api/shopify/oauth/callback
 */
export async function GET(request: Request) {
  const settingsOrigin = getShopifySettingsOrigin(request);
  const { searchParams } = new URL(request.url);

  try {
    const shopifyError = searchParams.get('error');
    if (shopifyError) {
      const description = searchParams.get('error_description');
      const message = description?.trim()
        ? `${shopifyError}: ${description}`
        : shopifyError;
      return settingsRedirect(settingsOrigin, { shopify_error: message });
    }

    const code = searchParams.get('code');
    const shop = searchParams.get('shop');
    const state = searchParams.get('state');

    if (!code || !shop || !state) {
      return settingsRedirect(settingsOrigin, {
        shopify_error: 'Missing OAuth parameters from Shopify',
      });
    }

    const oauthState = await consumeOAuthState(supabaseAdmin(), state);
    if (!oauthState) {
      return settingsRedirect(settingsOrigin, {
        shopify_error: 'OAuth session expired — try connecting again',
      });
    }

    let clientId = oauthState.api_key?.trim() ?? '';
    let clientSecret = '';
    if (oauthState.api_secret_encrypted) {
      try {
        clientSecret = decrypt(oauthState.api_secret_encrypted);
      } catch {
        return settingsRedirect(settingsOrigin, {
          shopify_error: 'Could not decrypt stored Client Secret — reconnect and re-enter it',
        });
      }
    }

    if (!clientId || !clientSecret) {
      if (!isShopifyOAuthConfigured()) {
        return settingsRedirect(settingsOrigin, {
          shopify_error: 'Missing Shopify app credentials for this connection',
        });
      }
      clientId = getShopifyApiKey();
      clientSecret = getShopifyApiSecret();
    }

    const token = await exchangeOAuthCode({
      shopDomain: shop,
      code,
      clientId,
      clientSecret,
    });

    let webhookCallbackUrl: string;
    try {
      webhookCallbackUrl = getShopifyWebhookUrl(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook URL not configured';
      return settingsRedirect(settingsOrigin, { shopify_error: message });
    }

    // Service role — OAuth may complete on a host without the browser session
    // (public SITE_URL callback). Account/user come from the verified state row.
    const result = await persistShopifyConfig({
      supabase: supabaseAdmin(),
      userId: oauthState.user_id,
      accountId: oauthState.account_id,
      shopDomain: shop,
      accessToken: token.access_token,
      scopes: token.scope.split(',').map((s) => s.trim()).filter(Boolean),
      webhookCallbackUrl,
      apiKey: clientId,
      apiSecret: clientSecret,
    });

    if (!result.ok) {
      return settingsRedirect(settingsOrigin, { shopify_error: result.error });
    }

    return settingsRedirect(settingsOrigin, { shopify_connected: '1' });
  } catch (err) {
    console.error('[shopify oauth callback]', err);
    const message = err instanceof Error ? err.message : 'Shopify connection failed';
    return settingsRedirect(settingsOrigin, { shopify_error: message });
  }
}
