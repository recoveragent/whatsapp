import type { SupabaseClient } from '@supabase/supabase-js';

import { sendInteractiveMediaCarousel } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  contactPhoneAfterSuccessfulSend,
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

import { buildShopifyCartCheckoutUrl } from './product-checkout-url';
import { getShopifyCatalogProduct } from './product-store';
import {
  buildProductCardBodyText,
  formatShopifyProductPrice,
} from './send-product-card';

const DEFAULT_BUTTON_LABEL = 'Buy now';
const MAX_CAROUSEL_CARDS = 10;

export interface SendShopifyProductCarouselArgs {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  /** Intro text shown above the swipeable cards. */
  bodyText: string;
  shopifyVariantIds: Array<string | number>;
  buttonLabel?: string;
  flowRunId?: string;
  skipAssigneeCheck?: boolean;
  aiGenerated?: boolean;
}

export interface SendShopifyProductCarouselResult {
  message_id: string;
  whatsapp_message_id: string;
  product_count: number;
}

export async function sendShopifyProductCarousel(
  args: SendShopifyProductCarouselArgs,
): Promise<SendShopifyProductCarouselResult> {
  const uniqueVariantIds = [
    ...new Set(
      args.shopifyVariantIds
        .map((id) => String(id).trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_CAROUSEL_CARDS);

  if (uniqueVariantIds.length < 2) {
    throw new Error('Product carousel requires at least 2 products.');
  }

  const products = (
    await Promise.all(
      uniqueVariantIds.map((variantId) =>
        getShopifyCatalogProduct({
          db: args.db,
          accountId: args.accountId,
          shopifyVariantId: variantId,
        }),
      ),
    )
  ).filter(
    (product): product is NonNullable<typeof product> =>
      Boolean(product?.in_stock && product.image_url?.trim()),
  );

  if (products.length < 2) {
    throw new Error('Need at least 2 in-stock products with images for a carousel.');
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

  const buttonLabel = (args.buttonLabel?.trim() || DEFAULT_BUTTON_LABEL).slice(0, 20);
  const shopDomain = shopifyConfig.shop_domain as string;
  const accessToken = decrypt(whatsappConfig.access_token as string);

  const cards = products.map((product, index) => ({
    cardIndex: index,
    imageUrl: product.image_url!.trim(),
    bodyText: buildProductCardBodyText({
      title: product.title,
      price: product.price,
      currency: product.currency,
      variantTitle: product.variant_title,
    }),
    buttonLabel,
    url: buildShopifyCartCheckoutUrl({
      shopDomain,
      variantId: product.shopify_variant_id,
      attributes: {
        source: 'wacrm',
        conversation_id: args.conversationId,
      },
    }),
  }));

  const attempt = async (phone: string): Promise<string> => {
    const result = await sendInteractiveMediaCarousel({
      phoneNumberId: whatsappConfig.phone_number_id as string,
      accessToken,
      to: phone,
      bodyText: args.bodyText.trim(),
      cards,
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

  const previewTitles = products.map((product) => product.title).join(', ');
  const contentPayload = {
    type: 'product_carousel',
    button_label: buttonLabel,
    products: products.map((product) => ({
      title: product.title,
      shopify_variant_id: product.shopify_variant_id,
      price: product.price,
      currency: product.currency,
      image_url: product.image_url,
      formatted_price: formatShopifyProductPrice(product.price, product.currency),
    })),
  };

  const { data: messageRecord, error: messageError } = await args.db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: args.flowRunId || args.aiGenerated ? 'bot' : 'agent',
      sender_id: args.flowRunId || args.aiGenerated ? null : args.userId,
      content_type: 'interactive',
      content_text: args.bodyText.trim(),
      content_payload: contentPayload,
      message_id: waMessageId,
      status: 'sent',
      ai_generated: Boolean(args.aiGenerated),
    })
    .select('id')
    .single();

  if (messageError || !messageRecord?.id) {
    throw new Error(
      `Carousel sent to Meta but failed to save to DB: ${messageError?.message ?? 'unknown error'}`,
    );
  }

  await args.db
    .from('conversations')
    .update({
      last_message_text: `${previewTitles.slice(0, 80)} · carousel`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId);

  return {
    message_id: messageRecord.id as string,
    whatsapp_message_id: waMessageId,
    product_count: products.length,
  };
}
