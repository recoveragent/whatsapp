import { NextResponse } from 'next/server';

import { exchangeOAuthCode } from '@/lib/shopify/admin-api';
import {
  getShopifyApiKey,
  getShopifyApiSecret,
} from '@/lib/shopify/config';
import { consumeOAuthState, persistShopifyConfig } from '@/lib/shopify/persist-config';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createClient } from '@/lib/supabase/server';

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
  const origin = new URL(request.url).origin;
  const { searchParams } = new URL(request.url);

  try {
    const shopifyError = searchParams.get('error');
    if (shopifyError) {
      const description = searchParams.get('error_description');
      const message = description?.trim()
        ? `${shopifyError}: ${description}`
        : shopifyError;
      return settingsRedirect(origin, { shopify_error: message });
    }

    const code = searchParams.get('code');
    const shop = searchParams.get('shop');
    const state = searchParams.get('state');

    if (!code || !shop || !state) {
      return settingsRedirect(origin, { shopify_error: 'Missing OAuth parameters from Shopify' });
    }

    const oauthState = await consumeOAuthState(supabaseAdmin(), state);
    if (!oauthState) {
      return settingsRedirect(origin, {
        shopify_error: 'OAuth session expired — try connecting again',
      });
    }

    const token = await exchangeOAuthCode({
      shopDomain: shop,
      code,
      clientId: getShopifyApiKey(),
      clientSecret: getShopifyApiSecret(),
    });

    const supabase = await createClient();
    const result = await persistShopifyConfig({
      supabase,
      userId: oauthState.user_id,
      accountId: oauthState.account_id,
      shopDomain: shop,
      accessToken: token.access_token,
      scopes: token.scope.split(',').map((s) => s.trim()).filter(Boolean),
      webhookCallbackUrl: `${origin}/api/shopify/webhook`,
    });

    if (!result.ok) {
      return settingsRedirect(origin, { shopify_error: result.error });
    }

    return settingsRedirect(origin, { shopify_connected: '1' });
  } catch (err) {
    console.error('[shopify oauth callback]', err);
    const message = err instanceof Error ? err.message : 'Shopify connection failed';
    return settingsRedirect(origin, { shopify_error: message });
  }
}
