import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { fetchShopInfo } from '@/lib/shopify/admin-api';
import { persistShopifyConfig } from '@/lib/shopify/persist-config';
import { decrypt } from '@/lib/whatsapp/encryption';

type RouteContext = { params: Promise<{ id: string }> };

async function healthCheck(
  config: { shop_domain: string; access_token: string } | null,
) {
  if (!config) {
    return {
      connected: false,
      reason: 'no_config',
      message: 'No Shopify configuration saved yet.',
    };
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    return {
      connected: false,
      reason: 'token_corrupted',
      needs_reset: true,
      message: 'Stored access token cannot be decrypted. Reset and reconnect.',
    };
  }

  try {
    const shop = await fetchShopInfo(config.shop_domain, accessToken);
    return { connected: true, shop };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Shopify API error';
    return {
      connected: false,
      reason: 'shopify_api_error',
      message: `Shopify rejected the credentials: ${message}`,
    };
  }
}

function webhookCallbackUrl(request: Request): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/shopify/webhook`;
}

/**
 * GET /api/admin/brands/[id]/shopify
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const accountId = ctx.brand.id;

    const { data: config, error } = await ctx.supabase
      .from('shopify_config')
      .select(
        'shop_domain, scopes, status, connected_at, access_token',
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 });
    }

    const safeConfig = config
      ? {
          shop_domain: config.shop_domain,
          scopes: config.scopes,
          status: config.status,
          connected_at: config.connected_at,
          has_access_token: Boolean(config.access_token),
        }
      : null;

    const health = await healthCheck(config);

    return NextResponse.json({
      brand: ctx.brand,
      config: safeConfig,
      health,
      webhook_url: webhookCallbackUrl(request),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/admin/brands/[id]/shopify
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const body = await request.json();
    const { shop_domain, access_token, scopes } = body;

    if (!shop_domain) {
      return NextResponse.json({ error: 'shop_domain is required' }, { status: 400 });
    }

    const { data: existing } = await ctx.supabase
      .from('shopify_config')
      .select('access_token')
      .eq('account_id', ctx.brand.id)
      .maybeSingle();

    let resolvedToken =
      typeof access_token === 'string' && access_token.trim()
        ? access_token.trim()
        : null;

    if (!resolvedToken && existing?.access_token) {
      try {
        resolvedToken = decrypt(existing.access_token);
      } catch {
        return NextResponse.json(
          { error: 'Stored token cannot be decrypted. Reset and re-enter.' },
          { status: 400 },
        );
      }
    }

    if (!resolvedToken) {
      return NextResponse.json({ error: 'access_token is required' }, { status: 400 });
    }

    const result = await persistShopifyConfig({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId: ctx.brand.id,
      shopDomain: shop_domain,
      accessToken: resolvedToken,
      scopes: Array.isArray(scopes) ? scopes : undefined,
      webhookCallbackUrl: webhookCallbackUrl(request),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, shop: result.shop });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/brands/[id]/shopify
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);

    const { error } = await ctx.supabase
      .from('shopify_config')
      .delete()
      .eq('account_id', ctx.brand.id);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
