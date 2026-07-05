import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureShopifyContact, ensureConversation } from '@/lib/shopify/ensure-contact'
import type { ShopifyEventContext } from '@/lib/shopify/types'
import { runFlowsForTrigger, type FlowDispatchOutcome } from './dispatch-external'
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

export interface ShopifyFlowDispatchOutcome {
  ok: boolean
  reason?: 'no_phone' | 'no_contact' | 'no_conversation'
  order_number?: string | null
  payment_status?: string | null
  dispatch?: FlowDispatchOutcome
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
}): Promise<ShopifyFlowDispatchOutcome> {
  const base = {
    order_number: args.context.orderNumber,
    payment_status: args.context.financialStatus,
  }

  const phone = args.context.phone
  if (!phone) {
    return { ok: false, reason: 'no_phone', ...base }
  }

  const contact = await ensureShopifyContact(
    args.db,
    args.accountId,
    args.ownerUserId,
    phone,
    args.context.customerName,
  )
  if (!contact) {
    return { ok: false, reason: 'no_contact', ...base }
  }

  const conversation = await ensureConversation(
    args.db,
    args.accountId,
    args.ownerUserId,
    contact.id,
  )
  if (!conversation) {
    return { ok: false, reason: 'no_conversation', ...base }
  }

  const dispatch = await runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: args.triggerType,
    contactId: contact.id,
    conversationId: conversation.id,
    context: { vars: contextToVars(args.context) },
  })

  return {
    ok: dispatch.started.length > 0,
    ...base,
    dispatch,
  }
}

export { shopifyTopicToFlowTrigger }
