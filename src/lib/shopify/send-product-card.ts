import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { SendProductNodeConfig } from '@/lib/flows/types';
import { sendInteractiveCtaUrl } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  contactPhoneAfterSuccessfulSend,
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

import { scheduleProductLinkRecovery } from './product-link-recovery';
import { buildShopifyCartCheckoutUrl } from './product-checkout-url';
import { getShopifyCatalogProduct } from './product-store';

const DEFAULT_BUTTON_LABEL = 'Buy now';

export function formatShopifyProductPrice(price: string, currency: string | null): string {
  const normalized = price.trim() || '0.00';
  if (currency === 'INR') return `₹${normalized}`;
  if (currency) return `${currency} ${normalized}`;
  return normalized;
}

export function buildProductCardBodyText(args: {
  title: string;
  price: string;
  currency: string | null;
  variantTitle?: string | null;
}): string {
  const priceLine = formatShopifyProductPrice(args.price, args.currency);
  const variantSuffix =
    args.variantTitle &&
    args.variantTitle.trim() &&
    args.variantTitle.trim().toLowerCase() !== 'default title'
      ? ` (${args.variantTitle.trim()})`
      : '';

  return `${args.title.trim()}${variantSuffix}\n${priceLine}`;
}

export function resolveSendProductVariantId(args: {
  cfg: SendProductNodeConfig;
  vars: Record<string, unknown>;
}): string {
  if (args.cfg.product_source === 'variable') {
    const key = args.cfg.variant_id_var?.trim() || 'shopify_variant_id';
    const raw = args.vars[key];
    if (raw == null || String(raw).trim() === '') {
      throw new Error(`Missing flow var "${key}" for send_product node`);
    }
    return String(raw).trim();
  }

  if (
    args.cfg.shopify_variant_id == null ||
    String(args.cfg.shopify_variant_id).trim() === ''
  ) {
    throw new Error('send_product node is missing shopify_variant_id');
  }

  return String(args.cfg.shopify_variant_id).trim();
}

export interface SendShopifyProductCardArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  conversationId: string;
  shopifyVariantId: string | number;
  quantity?: number;
  replyToMessageId?: string;
  flowRunId?: string;
  skipAssigneeCheck?: boolean;
  recoverySend?: boolean;
  skipRecoverySchedule?: boolean;
}

export interface SendShopifyProductCardResult {
  message_id: string;
  product_send_id?: string;
  whatsapp_message_id: string;
  checkout_url: string;
  product_title: string;
  shopify_variant_id: number;
  product_price: string;
  currency: string | null;
}

export async function sendShopifyProductCard(
  args: SendShopifyProductCardArgs,
): Promise<SendShopifyProductCardResult> {
  const product = await getShopifyCatalogProduct({
    db: args.db,
    accountId: args.accountId,
    shopifyVariantId: args.shopifyVariantId,
  });

  if (!product) {
    throw new Error('Product not found. Sync your Shopify catalog and try again.');
  }

  if (!product.in_stock) {
    throw new Error('This product is out of stock.');
  }

  const { data: shopifyConfig, error: shopifyConfigError } = await args.db
    .from('shopify_config')
    .select('shop_domain, sell_on_whatsapp_enabled, status')
    .eq('account_id', args.accountId)
    .maybeSingle();

  if (
    shopifyConfigError ||
    !shopifyConfig?.shop_domain ||
    shopifyConfig.status !== 'connected'
  ) {
    throw new Error('Shopify is not connected for this workspace.');
  }

  if (!shopifyConfig.sell_on_whatsapp_enabled) {
    throw new Error('Sell on WhatsApp is not enabled for this workspace.');
  }

  const { data: conversation, error: conversationError } = await args.db
    .from('conversations')
    .select('id, contact_id, assigned_agent_id, contact:contacts(id, phone)')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .single();

  if (conversationError || !conversation) {
    throw new Error('Conversation not found');
  }

  if (!args.flowRunId && !args.skipAssigneeCheck) {
    const assigneeId = (conversation.assigned_agent_id as string | null) ?? null;
    if (!assigneeId || assigneeId !== args.userId) {
      throw new Error(
        assigneeId
          ? 'This chat is assigned to someone else — reassign it to yourself before sending'
          : 'Self-assign this chat before sending',
      );
    }
  }

  const contact = conversation.contact as { id?: string; phone?: string } | null;
  if (!contact?.phone) {
    throw new Error('Contact phone number not found');
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new Error('Invalid phone number format');
  }

  const { data: whatsappConfig, error: whatsappConfigError } = await args.db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single();

  if (whatsappConfigError || !whatsappConfig) {
    throw new Error('WhatsApp is not configured for this workspace.');
  }

  const checkoutUrl = buildShopifyCartCheckoutUrl({
    shopDomain: shopifyConfig.shop_domain as string,
    variantId: product.shopify_variant_id,
    quantity: args.quantity,
    attributes: {
      source: 'wacrm',
      conversation_id: args.conversationId,
    },
  });

  const bodyText = buildProductCardBodyText({
    title: product.title,
    price: product.price,
    currency: product.currency,
    variantTitle: product.variant_title,
  });

  let contextMessageId: string | undefined;
  if (args.replyToMessageId) {
    const { data: parent } = await args.db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', args.replyToMessageId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle();

    if (parent?.message_id) {
      contextMessageId = parent.message_id;
    }
  }

  const accessToken = decrypt(whatsappConfig.access_token as string);

  const attempt = async (phone: string): Promise<string> => {
    const result = await sendInteractiveCtaUrl({
      phoneNumberId: whatsappConfig.phone_number_id as string,
      accessToken,
      to: phone,
      bodyText,
      buttonLabel: DEFAULT_BUTTON_LABEL,
      url: checkoutUrl,
      headerImageUrl: product.image_url ?? undefined,
      headerText: product.image_url ? undefined : product.title,
    });
    return result.messageId;
  };

  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  const variants = phoneVariants(sanitizedPhone);
  let lastError: unknown = null;

  for (const variant of variants) {
    try {
      waMessageId = await attempt(variant);
      workingPhone = variant;
      lastError = null;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(message)) throw err;
      lastError = err;
    }
  }

  if (lastError) throw lastError;

  if (workingPhone !== sanitizedPhone && contact.id) {
    await args.db
      .from('contacts')
      .update({
        phone: contactPhoneAfterSuccessfulSend(sanitizedPhone, workingPhone),
      })
      .eq('id', contact.id);
  }

  const contentPayload = {
    type: 'product_card',
    checkout_url: checkoutUrl,
    button_label: DEFAULT_BUTTON_LABEL,
    product_title: product.title,
    shopify_variant_id: product.shopify_variant_id,
    price: product.price,
    currency: product.currency,
    image_url: product.image_url,
  };

  const { data: messageRecord, error: messageError } = await args.db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: args.flowRunId || args.recoverySend ? 'bot' : 'agent',
      sender_id: args.flowRunId || args.recoverySend ? null : args.userId,
      content_type: 'interactive',
      content_text: bodyText,
      media_url: product.image_url,
      content_payload: contentPayload,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: args.replyToMessageId ?? null,
    })
    .select('id')
    .single();

  if (messageError || !messageRecord?.id) {
    throw new Error(
      `Message sent to Meta but failed to save to DB: ${messageError?.message ?? 'unknown error'}`,
    );
  }

  await args.db
    .from('conversations')
    .update({
      last_message_text: `${product.title} · ${DEFAULT_BUTTON_LABEL}`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId);

  const { data: productSendRow, error: productSendError } = await args.db
    .from('whatsapp_product_sends')
    .insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      message_id: messageRecord.id,
      shopify_variant_id: product.shopify_variant_id,
      product_title: product.title,
      checkout_url: checkoutUrl,
      sent_by_user_id: args.flowRunId || args.recoverySend ? null : args.userId,
      flow_run_id: args.flowRunId ?? null,
    })
    .select('id')
    .single();

  if (productSendError) {
    console.error('[shopify/product-card] product send audit failed:', productSendError);
  } else if (!args.skipRecoverySchedule && productSendRow?.id) {
    await scheduleProductLinkRecovery({
      db: args.db,
      accountId: args.accountId,
      productSendId: productSendRow.id as string,
      conversationId: args.conversationId,
      contactId: contact?.id ?? null,
      shopifyVariantId: product.shopify_variant_id,
      productTitle: product.title,
      checkoutUrl,
    });
  }

  if (!args.flowRunId && !args.recoverySend && contact.id) {
    try {
      await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', args.accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
    } catch (err) {
      console.error('[shopify/product-card] pause-on-agent-send failed:', err);
    }
  }

  return {
    message_id: messageRecord.id as string,
    product_send_id: productSendRow?.id as string | undefined,
    whatsapp_message_id: waMessageId,
    checkout_url: checkoutUrl,
    product_title: product.title,
    shopify_variant_id: product.shopify_variant_id,
    product_price: product.price,
    currency: product.currency,
  };
}
