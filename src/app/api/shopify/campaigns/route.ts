import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { SHOPIFY_CAMPAIGN_DEFINITIONS } from '@/lib/shopify/campaign-defaults';
import { seedDefaultCampaigns } from '@/lib/shopify/send-campaign';
import type { ShopifyCampaignType } from '@/lib/shopify/types';

const CAMPAIGN_TYPES = new Set<string>([
  'order_confirmation',
  'fulfillment_update',
  'abandoned_checkout',
]);

/**
 * GET /api/shopify/campaigns
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    await seedDefaultCampaigns(ctx.supabase, ctx.accountId);

    const { data, error } = await ctx.supabase
      .from('shopify_campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('campaign_type');

    if (error) {
      return NextResponse.json({ error: 'Failed to load campaigns' }, { status: 500 });
    }

    const definitions = SHOPIFY_CAMPAIGN_DEFINITIONS;

    return NextResponse.json({ campaigns: data ?? [], definitions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/shopify/campaigns
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    const {
      campaign_type,
      is_enabled,
      template_name,
      template_language,
      variable_mapping,
      delay_minutes,
    } = body;

    if (!campaign_type || !CAMPAIGN_TYPES.has(campaign_type)) {
      return NextResponse.json({ error: 'Invalid campaign_type' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof is_enabled === 'boolean') patch.is_enabled = is_enabled;
    if (template_name !== undefined) patch.template_name = template_name || null;
    if (typeof template_language === 'string') patch.template_language = template_language;
    if (variable_mapping && typeof variable_mapping === 'object') {
      patch.variable_mapping = variable_mapping;
    }
    if (typeof delay_minutes === 'number') {
      patch.delay_minutes = Math.min(10080, Math.max(5, delay_minutes));
    }

    const { data, error } = await ctx.supabase
      .from('shopify_campaigns')
      .update(patch)
      .eq('account_id', ctx.accountId)
      .eq('campaign_type', campaign_type as ShopifyCampaignType)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
    }

    return NextResponse.json({ campaign: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
