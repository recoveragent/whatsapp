import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest } from '@/lib/api/v1/respond';
import { sendShopifyProductCard } from '@/lib/shopify/send-product-card';

export interface ProductLinkSentEvent {
  conversation_id: string;
  shopify_variant_id: string | number;
  quantity?: number;
  schedule_recovery?: boolean;
}

export async function ingestProductLinkSentEvent(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  body: ProductLinkSentEvent;
}): Promise<{ product_send_id?: string; checkout_url?: string }> {
  const conversationId = args.body.conversation_id?.trim();
  if (!conversationId) {
    throw badRequest('conversation_id is required');
  }

  const variantId = args.body.shopify_variant_id;
  if (variantId == null || String(variantId).trim() === '') {
    throw badRequest('shopify_variant_id is required');
  }

  const result = await sendShopifyProductCard({
    db: args.db,
    accountId: args.accountId,
    userId: args.ownerUserId,
    conversationId,
    shopifyVariantId: variantId,
    quantity: args.body.quantity,
    skipAssigneeCheck: true,
    skipRecoverySchedule: args.body.schedule_recovery === false,
  });

  return {
    product_send_id: result.product_send_id,
    checkout_url: result.checkout_url,
  };
}
