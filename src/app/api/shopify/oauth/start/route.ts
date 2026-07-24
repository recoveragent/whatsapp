import { NextResponse } from 'next/server';

import {
  BrandContextRequiredError,
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  getShopifyApiKey,
  getShopifyApiSecret,
  getShopifyRedirectUri,
  getShopifyScopes,
  isShopifyOAuthConfigured,
} from '@/lib/shopify/config';
import { normalizeShopDomain } from '@/lib/shopify/normalize-shop';
import { createOAuthState } from '@/lib/shopify/persist-config';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * POST /api/shopify/oauth/start
 *
 * Body: { shop, client_id?, client_secret? }
 * When client_id/secret are omitted, uses credentials already stored on
 * shopify_config (reconnect) or falls back to server SHOPIFY_API_* env.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      shop?: string;
      client_id?: string;
      client_secret?: string;
    } | null;

    const shopInput = body?.shop?.trim();
    if (!shopInput) {
      return NextResponse.json({ error: 'Shop domain is required' }, { status: 400 });
    }

    const shopDomain = normalizeShopDomain(shopInput);
    if (!shopDomain) {
      return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
    }

    let clientId = body?.client_id?.trim() ?? '';
    let clientSecret = body?.client_secret?.trim() ?? '';

    if (!clientId || !clientSecret) {
      const { data: existing } = await ctx.supabase
        .from('shopify_config')
        .select('api_key, api_secret')
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!clientId && existing?.api_key) {
        clientId = existing.api_key as string;
      }
      if (!clientSecret && existing?.api_secret) {
        try {
          clientSecret = decrypt(existing.api_secret as string);
        } catch {
          return NextResponse.json(
            { error: 'Stored Client Secret cannot be decrypted — re-enter it' },
            { status: 400 },
          );
        }
      }
    }

    if (!clientId || !clientSecret) {
      if (isShopifyOAuthConfigured()) {
        clientId = getShopifyApiKey();
        clientSecret = getShopifyApiSecret();
      } else {
        return NextResponse.json(
          {
            error:
              'Enter the Client ID and Client Secret from your Shopify custom app',
          },
          { status: 400 },
        );
      }
    }

    const state = await createOAuthState({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      shopDomain,
      apiKey: clientId,
      apiSecret: clientSecret,
    });

    const redirectUri = getShopifyRedirectUri(request);
    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('scope', getShopifyScopes());
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return NextResponse.json({ authorize_url: authorizeUrl.toString() });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Sign in again to connect Shopify' }, { status: 401 });
    }
    if (err instanceof BrandContextRequiredError) {
      return NextResponse.json(
        {
          error: 'Open a brand first (Brands → Open as admin), then connect Shopify',
          needsBrandContext: true,
        },
        { status: 403 },
      );
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[shopify oauth start]', err);
    return toErrorResponse(err);
  }
}

/**
 * GET kept for backwards compatibility — requires env-configured app
 * and cannot accept secrets. Prefer POST.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const redirectError = (message: string) =>
    NextResponse.redirect(
      `${origin}/settings?tab=shopify&shopify_error=${encodeURIComponent(message)}`,
    );

  try {
    const ctx = await requireRole('admin');
    const shopInput = new URL(request.url).searchParams.get('shop');
    if (!shopInput) return redirectError('Shop domain is required');

    const shopDomain = normalizeShopDomain(shopInput);
    if (!shopDomain) return redirectError('Invalid shop domain');

    const { data: existing } = await ctx.supabase
      .from('shopify_config')
      .select('api_key, api_secret')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    let clientId = (existing?.api_key as string | null) ?? '';
    let clientSecret = '';
    if (existing?.api_secret) {
      try {
        clientSecret = decrypt(existing.api_secret as string);
      } catch {
        return redirectError('Stored Client Secret cannot be decrypted — re-enter it');
      }
    }

    if (!clientId || !clientSecret) {
      if (!isShopifyOAuthConfigured()) {
        return redirectError(
          'Enter Client ID and Client Secret from your Shopify custom app, then connect again',
        );
      }
      clientId = getShopifyApiKey();
      clientSecret = getShopifyApiSecret();
    }

    const state = await createOAuthState({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      shopDomain,
      apiKey: clientId,
      apiSecret: clientSecret,
    });

    const redirectUri = getShopifyRedirectUri(request);
    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('scope', getShopifyScopes());
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return NextResponse.redirect(authorizeUrl.toString());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return redirectError('Sign in again to connect Shopify');
    }
    if (err instanceof BrandContextRequiredError) {
      return redirectError('Open a brand first, then connect Shopify');
    }
    if (err instanceof ForbiddenError) {
      return redirectError(err.message);
    }
    console.error('[shopify oauth start GET]', err);
    return redirectError(
      err instanceof Error ? err.message : 'Could not start Shopify connection',
    );
  }
}
