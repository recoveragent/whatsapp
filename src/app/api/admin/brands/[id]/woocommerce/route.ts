import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { verifyWooCommerceCredentials } from '@/lib/woocommerce/admin-api';
import { getWooCommerceWebhookUrl } from '@/lib/woocommerce/config';
import { persistWooCommerceConfig } from '@/lib/woocommerce/persist-config';
import { decrypt } from '@/lib/whatsapp/encryption';

type RouteContext = { params: Promise<{ id: string }> };

async function healthCheck(
  config: {
    store_url: string;
    consumer_key: string;
    consumer_secret: string;
  } | null,
) {
  if (!config) {
    return {
      connected: false,
      reason: 'no_config',
      message: 'No WooCommerce configuration saved yet.',
    };
  }

  let consumerKey: string;
  let consumerSecret: string;
  try {
    consumerKey = decrypt(config.consumer_key);
    consumerSecret = decrypt(config.consumer_secret);
  } catch {
    return {
      connected: false,
      reason: 'credentials_corrupted',
      needs_reset: true,
      message: 'Stored credentials cannot be decrypted. Reset and reconnect.',
    };
  }

  try {
    const store = await verifyWooCommerceCredentials({
      storeUrl: config.store_url,
      consumerKey,
      consumerSecret,
    });
    return { connected: true, store };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WooCommerce API error';
    return {
      connected: false,
      reason: 'woocommerce_api_error',
      message: `WooCommerce rejected the credentials: ${message}`,
    };
  }
}

/**
 * GET /api/admin/brands/[id]/woocommerce
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const accountId = ctx.brand.id;

    const platform = await assertEcommercePlatform(ctx.supabase, accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { data: config, error } = await ctx.supabase
      .from('woocommerce_config')
      .select('store_url, status, connected_at, consumer_key, consumer_secret')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 });
    }

    const safeConfig = config
      ? {
          store_url: config.store_url,
          status: config.status,
          connected_at: config.connected_at,
          has_credentials: Boolean(config.consumer_key && config.consumer_secret),
        }
      : null;

    const health = await healthCheck(config);

    let webhookUrl = '';
    try {
      webhookUrl = getWooCommerceWebhookUrl(request);
    } catch {
      webhookUrl = '';
    }

    return NextResponse.json({
      brand: ctx.brand,
      config: safeConfig,
      health,
      webhook_url: webhookUrl,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/admin/brands/[id]/woocommerce
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const body = (await request.json()) as {
      store_url?: unknown;
      consumer_key?: unknown;
      consumer_secret?: unknown;
    };

    const storeUrl = typeof body.store_url === 'string' ? body.store_url : '';
    const consumerKey = typeof body.consumer_key === 'string' ? body.consumer_key : '';
    const consumerSecret = typeof body.consumer_secret === 'string' ? body.consumer_secret : '';

    if (!storeUrl.trim()) {
      return NextResponse.json({ error: 'store_url is required' }, { status: 400 });
    }
    if (!consumerKey.trim() || !consumerSecret.trim()) {
      return NextResponse.json({ error: 'consumer_key and consumer_secret are required' }, { status: 400 });
    }

    let webhookUrl: string;
    try {
      webhookUrl = getWooCommerceWebhookUrl(request);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : 'Set NEXT_PUBLIC_SITE_URL before connecting WooCommerce',
        },
        { status: 400 },
      );
    }

    const result = await persistWooCommerceConfig({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId: ctx.brand.id,
      storeUrl,
      consumerKey,
      consumerSecret,
      webhookCallbackUrl: webhookUrl,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, store: result.store });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/brands/[id]/woocommerce
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.brand.id, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { error } = await ctx.supabase
      .from('woocommerce_config')
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
