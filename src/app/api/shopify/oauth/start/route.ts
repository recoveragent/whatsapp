import { NextResponse } from 'next/server';

import {
  BrandContextRequiredError,
  ForbiddenError,
  UnauthorizedError,
  requireRole,
} from '@/lib/auth/account';
import {
  getShopifyApiKey,
  getShopifyRedirectUri,
  getShopifyScopes,
  isShopifyOAuthConfigured,
} from '@/lib/shopify/config';
import { normalizeShopDomain } from '@/lib/shopify/normalize-shop';
import { createOAuthState } from '@/lib/shopify/persist-config';
import { supabaseAdmin } from '@/lib/automations/admin-client';

function redirectOAuthError(request: Request, message: string): NextResponse {
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(
    `${origin}/settings?tab=shopify&shopify_error=${encodeURIComponent(message)}`,
  );
}

/**
 * GET /api/shopify/oauth/start?shop=mystore
 */
export async function GET(request: Request) {
  try {
    if (!isShopifyOAuthConfigured()) {
      return redirectOAuthError(
        request,
        'Shopify OAuth is not configured on this server. Check SHOPIFY_API_KEY and SHOPIFY_API_SECRET.',
      );
    }

    const ctx = await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const shopInput = searchParams.get('shop');

    if (!shopInput) {
      return redirectOAuthError(request, 'Shop domain is required');
    }

    const shopDomain = normalizeShopDomain(shopInput);
    if (!shopDomain) {
      return redirectOAuthError(request, 'Invalid shop domain');
    }

    const state = await createOAuthState({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
      shopDomain,
    });

    const redirectUri = getShopifyRedirectUri(new URL(request.url).origin);
    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set('client_id', getShopifyApiKey());
    authorizeUrl.searchParams.set('scope', getShopifyScopes());
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);

    return NextResponse.redirect(authorizeUrl.toString());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return redirectOAuthError(request, 'Sign in again to connect Shopify');
    }
    if (err instanceof ForbiddenError || err instanceof BrandContextRequiredError) {
      return redirectOAuthError(
        request,
        err instanceof BrandContextRequiredError
          ? 'Open a brand first (Brands → Open as admin), then connect Shopify'
          : err.message,
      );
    }
    console.error('[shopify oauth start]', err);
    const message =
      err instanceof Error ? err.message : 'Could not start Shopify connection';
    return redirectOAuthError(request, message);
  }
}
