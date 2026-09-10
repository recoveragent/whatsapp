import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { registerShopifyWebhooks } from '@/lib/shopify/admin-api';
import { getShopifyWebhookUrl } from '@/lib/shopify/config';
import {
  PRODUCT_LINK_RECOVERY_DELAY_MAX,
  PRODUCT_LINK_RECOVERY_DELAY_MIN,
} from '@/lib/shopify/product-link-recovery';
import { syncShopifyProductsForAccount } from '@/lib/shopify/products-sync';
import { decrypt } from '@/lib/whatsapp/encryption';

function parseRecoveryDelay(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.min(
    PRODUCT_LINK_RECOVERY_DELAY_MAX,
    Math.max(PRODUCT_LINK_RECOVERY_DELAY_MIN, Math.floor(raw)),
  );
}

/**
 * GET /api/shopify/sell-on-whatsapp
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { data: config, error } = await ctx.supabase
      .from('shopify_config')
      .select(
        'sell_on_whatsapp_enabled, products_last_synced_at, product_link_recovery_enabled, product_link_recovery_delay_minutes, status, shop_domain',
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }

    const { count: productCount } = await ctx.supabase
      .from('shopify_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('status', 'active');

    const { data: latestRun } = await ctx.supabase
      .from('shopify_product_sync_runs')
      .select('status, products_upserted, products_archived, error_message, finished_at')
      .eq('account_id', ctx.accountId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      enabled: Boolean(config?.sell_on_whatsapp_enabled),
      connected: config?.status === 'connected',
      shop_domain: config?.shop_domain ?? null,
      products_last_synced_at: config?.products_last_synced_at ?? null,
      active_product_count: productCount ?? 0,
      product_link_recovery_enabled: Boolean(config?.product_link_recovery_enabled),
      product_link_recovery_delay_minutes:
        config?.product_link_recovery_delay_minutes ?? 60,
      latest_sync: latestRun ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/shopify/sell-on-whatsapp
 * Body: { enabled?, product_link_recovery_enabled?, product_link_recovery_delay_minutes? }
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const body = await request.json();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ('enabled' in body && typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    if (
      'product_link_recovery_enabled' in body &&
      typeof body.product_link_recovery_enabled !== 'boolean'
    ) {
      return NextResponse.json(
        { error: 'product_link_recovery_enabled must be a boolean' },
        { status: 400 },
      );
    }
    if ('product_link_recovery_delay_minutes' in body) {
      const delay = parseRecoveryDelay(body.product_link_recovery_delay_minutes);
      if (delay == null) {
        return NextResponse.json(
          {
            error: `product_link_recovery_delay_minutes must be between ${PRODUCT_LINK_RECOVERY_DELAY_MIN} and ${PRODUCT_LINK_RECOVERY_DELAY_MAX}`,
          },
          { status: 400 },
        );
      }
      patch.product_link_recovery_delay_minutes = delay;
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('shopify_config')
      .select('status, shop_domain, access_token, sell_on_whatsapp_enabled')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (configError || !config || config.status !== 'connected') {
      return NextResponse.json(
        { error: 'Connect Shopify before updating Sell on WhatsApp settings.' },
        { status: 400 },
      );
    }

    if (typeof body.enabled === 'boolean') {
      patch.sell_on_whatsapp_enabled = body.enabled;
    }
    if (typeof body.product_link_recovery_enabled === 'boolean') {
      patch.product_link_recovery_enabled = body.product_link_recovery_enabled;
    }

    const { error: updateError } = await ctx.supabase
      .from('shopify_config')
      .update(patch)
      .eq('account_id', ctx.accountId);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    let syncResult = null;
    const sellEnabled =
      typeof body.enabled === 'boolean'
        ? body.enabled
        : Boolean(config.sell_on_whatsapp_enabled);

    if (sellEnabled) {
      try {
        const webhookUrl = getShopifyWebhookUrl(request);
        const accessToken = decrypt(config.access_token as string);
        await registerShopifyWebhooks({
          shopDomain: config.shop_domain as string,
          accessToken,
          callbackUrl: webhookUrl,
        });
      } catch (err) {
        console.warn('[shopify/sell-on-whatsapp] webhook registration:', err);
      }
    }

    if (body.enabled === true) {
      syncResult = await syncShopifyProductsForAccount(supabaseAdmin(), ctx.accountId);
    }

    return NextResponse.json({
      enabled:
        typeof body.enabled === 'boolean'
          ? body.enabled
          : Boolean(config.sell_on_whatsapp_enabled),
      product_link_recovery_enabled:
        typeof body.product_link_recovery_enabled === 'boolean'
          ? body.product_link_recovery_enabled
          : undefined,
      sync: syncResult,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
