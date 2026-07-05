import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureShopifyContact, ensureConversation } from '@/lib/shopify/ensure-contact'
import type { ShopifyEventContext } from '@/lib/shopify/types'
import { runFlowsForTrigger } from './dispatch-external'
import { shopifyTopicToFlowTrigger, type FlowTriggerType } from './trigger-types'

function contextToVars(ctx: ShopifyEventContext): Record<string, unknown> {
  return {
    customer_name: ctx.customerName,
    phone: ctx.phone,
    email: ctx.email,
    order_number: ctx.orderNumber,
    order_total: ctx.orderTotal,
    order_items: ctx.orderItems,
    tracking_number: ctx.trackingNumber,
    tracking_url: ctx.trackingUrl,
    checkout_url: ctx.checkoutUrl,
    fulfillment_status: ctx.fulfillmentStatus,
    payment_status: ctx.financialStatus,
    financial_status: ctx.financialStatus,
    shop_name: ctx.shopName,
    name: ctx.customerName,
  }
}

/**
 * Dispatch active Shopify-triggered flows for an order event.
 */
export async function dispatchShopifyFlows(args: {
  db: SupabaseClient
  accountId: string
  ownerUserId: string
  triggerType: FlowTriggerType
  context: ShopifyEventContext
}): Promise<void> {
  const phone = args.context.phone
  if (!phone) return

  const contact = await ensureShopifyContact(
    args.db,
    args.accountId,
    args.ownerUserId,
    phone,
    args.context.customerName,
  )
  if (!contact) return

  const conversation = await ensureConversation(
    args.db,
    args.accountId,
    args.ownerUserId,
    contact.id,
  )
  if (!conversation) return

  await runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: args.triggerType,
    contactId: contact.id,
    conversationId: conversation.id,
    context: { vars: contextToVars(args.context) },
  })
}

export { shopifyTopicToFlowTrigger }
