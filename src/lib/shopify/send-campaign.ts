import type { SupabaseClient } from '@supabase/supabase-js';

import { engineSendTemplate } from '@/lib/automations/meta-send';
import { getCampaignDefinition } from './campaign-defaults';
import { buildTemplateParams } from './extract-context';
import { ensureConversation, ensureShopifyContact } from './ensure-contact';
import type {
  ShopifyCampaignRow,
  ShopifyCampaignType,
  ShopifyEventContext,
} from './types';

export async function seedDefaultCampaigns(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  for (const def of [
    getCampaignDefinition('order_confirmation'),
    getCampaignDefinition('fulfillment_update'),
    getCampaignDefinition('abandoned_checkout'),
  ]) {
    const { error } = await db.from('shopify_campaigns').upsert(
      {
        account_id: accountId,
        campaign_type: def.campaign_type,
        is_enabled: false,
        template_language: 'en_US',
        variable_mapping: def.suggested_variables,
        delay_minutes: def.default_delay_minutes ?? 60,
      },
      { onConflict: 'account_id,campaign_type', ignoreDuplicates: true },
    );
    if (error) {
      console.error('[shopify] seedDefaultCampaigns:', error);
    }
  }
}

export async function loadCampaign(
  db: SupabaseClient,
  accountId: string,
  campaignType: ShopifyCampaignType,
): Promise<ShopifyCampaignRow | null> {
  const { data, error } = await db
    .from('shopify_campaigns')
    .select('*')
    .eq('account_id', accountId)
    .eq('campaign_type', campaignType)
    .maybeSingle();

  if (error) {
    console.error('[shopify] loadCampaign failed:', error);
    return null;
  }

  return data as ShopifyCampaignRow | null;
}

export async function sendShopifyCampaign(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  campaign: ShopifyCampaignRow;
  context: ShopifyEventContext;
}): Promise<{ ok: boolean; error?: string }> {
  const { db, accountId, ownerUserId, campaign, context } = args;

  if (!campaign.is_enabled || !campaign.template_name) {
    return { ok: false, error: 'campaign disabled or missing template' };
  }

  if (!context.phone) {
    return { ok: false, error: 'no phone on order/checkout' };
  }

  const { data: existingLog } = await db
    .from('shopify_message_log')
    .select('id')
    .eq('account_id', accountId)
    .eq('campaign_type', campaign.campaign_type)
    .eq('resource_key', context.resourceKey)
    .maybeSingle();

  if (existingLog) {
    return { ok: false, error: 'already sent' };
  }

  const contact = await ensureShopifyContact(
    db,
    accountId,
    ownerUserId,
    context.phone,
    context.customerName,
  );
  if (!contact) {
    return { ok: false, error: 'could not create contact' };
  }

  const conversation = await ensureConversation(
    db,
    accountId,
    ownerUserId,
    contact.id,
  );
  if (!conversation) {
    return { ok: false, error: 'could not create conversation' };
  }

  const params = buildTemplateParams(campaign.variable_mapping ?? {}, context);

  try {
    const result = await engineSendTemplate({
      accountId,
      userId: ownerUserId,
      conversationId: conversation.id,
      contactId: contact.id,
      templateName: campaign.template_name,
      language: campaign.template_language,
      params,
    });

    await db.from('shopify_message_log').insert({
      account_id: accountId,
      campaign_type: campaign.campaign_type,
      resource_key: context.resourceKey,
      contact_id: contact.id,
      whatsapp_message_id: result.whatsapp_message_id,
      status: 'sent',
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send failed';
    await db.from('shopify_message_log').insert({
      account_id: accountId,
      campaign_type: campaign.campaign_type,
      resource_key: context.resourceKey,
      contact_id: contact.id,
      status: 'failed',
      error_message: message,
    });
    return { ok: false, error: message };
  }
}
