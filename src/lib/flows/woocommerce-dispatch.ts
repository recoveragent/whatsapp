import type { SupabaseClient } from '@supabase/supabase-js';

import {
  deleteConversationIfEmpty,
  ensureConversation,
  ensureShopifyContact,
} from '@/lib/shopify/ensure-contact';
import { runFlowsForTrigger, type FlowDispatchOutcome } from '@/lib/flows/dispatch-external';
import type { FlowTriggerType } from '@/lib/flows/trigger-types';
import type { WooCommerceEventContext } from '@/lib/woocommerce/types';

function woocommerceOrderIdFromContext(ctx: WooCommerceEventContext): string | undefined {
  if (!ctx.resourceKey.startsWith('order:')) return undefined;
  const id = ctx.resourceKey.slice('order:'.length).trim();
  return id || undefined;
}

function contextToVars(ctx: WooCommerceEventContext): Record<string, unknown> {
  return {
    customer_name: ctx.customerName,
    phone: ctx.phone,
    email: ctx.email,
    order_number: ctx.orderNumber,
    order_total: ctx.orderTotal,
    order_items: ctx.orderItems,
    woocommerce_order_id: woocommerceOrderIdFromContext(ctx),
    payment_status: ctx.paymentStatus,
    fulfillment_status: ctx.fulfillmentStatus,
    order_status_url: ctx.orderStatusUrl,
    shop_name: ctx.storeName,
    store_name: ctx.storeName,
    name: ctx.customerName,
  };
}

export interface WooCommerceFlowDispatchOutcome {
  ok: boolean;
  reason?: 'no_phone' | 'no_contact' | 'no_conversation';
  order_number?: string | null;
  payment_status?: string | null;
  dispatch?: FlowDispatchOutcome;
}

/**
 * Dispatch active WooCommerce-triggered flows for an order event.
 */
export async function dispatchWooCommerceFlows(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  triggerType: FlowTriggerType;
  context: WooCommerceEventContext;
}): Promise<WooCommerceFlowDispatchOutcome> {
  const base = {
    order_number: args.context.orderNumber,
    payment_status: args.context.paymentStatus,
  };

  const phone = args.context.phone;
  if (!phone) {
    return { ok: false, reason: 'no_phone', ...base };
  }

  const contact = await ensureShopifyContact(
    args.db,
    args.accountId,
    args.ownerUserId,
    phone,
    args.context.customerName ?? phone,
  );
  if (!contact) {
    return { ok: false, reason: 'no_contact', ...base };
  }

  const conversation = await ensureConversation(
    args.db,
    args.accountId,
    args.ownerUserId,
    contact.id,
  );
  if (!conversation) {
    return { ok: false, reason: 'no_conversation', ...base };
  }

  const dispatch = await runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: args.triggerType,
    contactId: contact.id,
    conversationId: conversation.id,
    context: { vars: contextToVars(args.context) },
  });

  const blockedByActiveRun = dispatch.skipped.some(
    (s) => s.reason === 'active_run_exists',
  );
  if (!blockedByActiveRun) {
    await deleteConversationIfEmpty(args.db, conversation.id, {
      accountId: args.accountId,
      contactId: contact.id,
    });
  }

  return {
    ok: dispatch.started.length > 0,
    ...base,
    dispatch,
  };
}
