import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyWooCommerceCredentials } from '@/lib/woocommerce/admin-api';
import { getWooCommerceWebhookUrl } from '@/lib/woocommerce/config';
import { persistWooCommerceConfig } from '@/lib/woocommerce/persist-config';

/**
 * GET /api/woocommerce/connection
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    let webhookUrl: string | null = null;
    try {
      webhookUrl = getWooCommerceWebhookUrl(request);
    } catch {
      webhookUrl = null;
    }

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { data: config, error } = await ctx.supabase
      .from('woocommerce_config')
      .select('store_url, status, connected_at, consumer_key, consumer_secret')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load connection status' }, { status: 500 });
    }

    if (!config?.store_url) {
      return NextResponse.json({
        configured: false,
        connected: false,
        webhook_url: webhookUrl,
        message:
          'Create REST API keys in WooCommerce (Settings → Advanced → REST API), then enter store URL and keys below.',
      });
    }

    let storeName: string | null = null;
    let connected = config.status === 'connected';

    if (config.consumer_key && config.consumer_secret) {
      try {
        const consumerKey = decrypt(config.consumer_key as string);
        const consumerSecret = decrypt(config.consumer_secret as string);
        const verified = await verifyWooCommerceCredentials({
          storeUrl: config.store_url as string,
          consumerKey,
          consumerSecret,
        });
        storeName = verified.store_name;
        connected = true;
      } catch {
        connected = false;
      }
    }

    return NextResponse.json({
      configured: true,
      connected,
      needs_reconnect: !connected,
      store_url: config.store_url,
      store_name: storeName,
      connected_at: config.connected_at,
      webhook_url: webhookUrl,
      message: connected
        ? 'Webhooks are registered. New orders will sync to the inbox.'
        : 'Your WooCommerce API keys may have been revoked. Reconnect to restore order sync.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/woocommerce/connection
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as {
      store_url?: unknown;
      consumer_key?: unknown;
      consumer_secret?: unknown;
    } | null;

    const storeUrl = typeof body?.store_url === 'string' ? body.store_url : '';
    const consumerKey = typeof body?.consumer_key === 'string' ? body.consumer_key : '';
    const consumerSecret = typeof body?.consumer_secret === 'string' ? body.consumer_secret : '';

    if (!storeUrl.trim()) {
      return NextResponse.json({ error: 'Store URL is required' }, { status: 400 });
    }
    if (!consumerKey.trim() || !consumerSecret.trim()) {
      return NextResponse.json({ error: 'Consumer key and secret are required' }, { status: 400 });
    }

    const result = await persistWooCommerceConfig({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId: ctx.accountId,
      storeUrl,
      consumerKey,
      consumerSecret,
      webhookCallbackUrl: getWooCommerceWebhookUrl(request),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      store_url: result.store.url,
      store_name: result.store.name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/woocommerce/connection
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'woocommerce');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { error } = await ctx.supabase
      .from('woocommerce_config')
      .delete()
      .eq('account_id', ctx.accountId);

    if (error) {
      return NextResponse.json({ error: 'Failed to disconnect WooCommerce' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
