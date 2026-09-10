import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest } from '@/lib/api/v1/respond';
import { resolveOwnerUserId } from '@/lib/api/v1/external-send';
import { runFlowsForTrigger } from '@/lib/flows/dispatch-external';
import { enrichCheckoutAppWebhookVars } from '@/lib/flows/checkout-app-webhook';
import {
  deleteConversationIfEmpty,
  ensureConversation,
  ensureShopifyContact,
} from '@/lib/shopify/ensure-contact';
import { loadCampaign, sendShopifyCampaign } from '@/lib/shopify/send-campaign';
import type { ShopifyEventContext } from '@/lib/shopify/types';
import {
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

export const RECOVER_AGENT_MIRROR_PAYLOAD_KEY = '_wa_recover_agent_mirror';

export interface RecoverAgentAbandonedCheckoutMetadata {
  company_id?: string;
  workflow_slug?: string;
  queue_id?: string;
  source?: string;
}

export interface RecoverAgentAbandonedCheckoutEvent {
  event?: string;
  checkout_id?: string;
  token?: string;
  phone?: string;
  customer_name?: string;
  product?: string;
  amount?: number;
  checkout_url?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  fire_after?: string;
  flat?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  metadata?: RecoverAgentAbandonedCheckoutMetadata;
}

export interface RecoverAgentMirrorPayload {
  [RECOVER_AGENT_MIRROR_PAYLOAD_KEY]: true;
  event: RecoverAgentAbandonedCheckoutEvent;
}

export function isRecoverAgentMirrorPayload(
  payload: unknown,
): payload is RecoverAgentMirrorPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as RecoverAgentMirrorPayload)[RECOVER_AGENT_MIRROR_PAYLOAD_KEY] === true &&
    typeof (payload as RecoverAgentMirrorPayload).event === 'object' &&
    (payload as RecoverAgentMirrorPayload).event !== null
  );
}

function parseFireAfter(raw: unknown): Date {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function checkoutKeyFromEvent(event: RecoverAgentAbandonedCheckoutEvent): string {
  const checkoutId = event.checkout_id?.trim();
  if (checkoutId) return checkoutId;
  const token = event.token?.trim();
  if (token) return token;
  return '';
}

function formatShippingAddress(event: RecoverAgentAbandonedCheckoutEvent): string | null {
  const parts = [event.address1, event.city, event.state, event.zip]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function contextFromRecoverAgentEvent(
  event: RecoverAgentAbandonedCheckoutEvent,
): ShopifyEventContext {
  const checkoutKey = checkoutKeyFromEvent(event);
  const customerName = event.customer_name?.trim() || 'Customer';

  return {
    customerName,
    phone: event.phone?.trim() || null,
    email: null,
    orderNumber: null,
    orderTotal:
      typeof event.amount === 'number' && Number.isFinite(event.amount)
        ? String(event.amount)
        : null,
    orderItems: event.product?.trim() || null,
    productImage: null,
    shippingAddress: formatShippingAddress(event),
    shippingAddressFields:
      event.address1 || event.city || event.state || event.zip
        ? {
            address1: event.address1,
            city: event.city,
            province: event.state,
            zip: event.zip,
          }
        : null,
    trackingNumber: null,
    trackingUrl: null,
    orderStatusUrl: null,
    orderStatusUrlSuffix: null,
    trackingRedirectSuffix: null,
    checkoutUrl: event.checkout_url?.trim() || null,
    fulfillmentStatus: null,
    shipmentStatus: null,
    financialStatus: null,
    shopName: '',
    resourceKey: checkoutKey ? `checkout:${checkoutKey}` : 'checkout:unknown',
  };
}

function flowVarsFromRecoverAgentEvent(
  event: RecoverAgentAbandonedCheckoutEvent,
): Record<string, unknown> {
  const context = contextFromRecoverAgentEvent(event);
  const base: Record<string, unknown> = {
    customer_name: context.customerName,
    name: context.customerName,
    phone: context.phone,
    checkout_id: checkoutKeyFromEvent(event) || undefined,
    checkout_url: context.checkoutUrl,
    order_total: context.orderTotal,
    order_items: context.orderItems,
    product: event.product?.trim() || context.orderItems,
    amount: event.amount,
    shipping_address: context.shippingAddress,
    address1: event.address1,
    city: event.city,
    state: event.state,
    zip: event.zip,
    recover_agent_metadata: event.metadata ?? null,
  };

  const merged = {
    ...base,
    ...(event.flat ?? {}),
  };

  return enrichCheckoutAppWebhookVars(event.raw ?? event, merged);
}

export function validateRecoverAgentAbandonedCheckoutEvent(
  body: RecoverAgentAbandonedCheckoutEvent,
): {
  event: RecoverAgentAbandonedCheckoutEvent;
  checkoutKey: string;
  phone: string;
  fireAfter: Date;
} {
  if (body.event && body.event !== 'abandoned_checkout') {
    throw badRequest('event must be "abandoned_checkout" when provided');
  }

  const checkoutKey = checkoutKeyFromEvent(body);
  if (!checkoutKey) {
    throw badRequest('checkout_id or token is required');
  }

  const phoneRaw = body.phone?.trim();
  if (!phoneRaw) {
    throw badRequest('phone is required');
  }

  const phone = sanitizePhoneForMeta(phoneRaw);
  if (!isValidE164(phone)) {
    throw badRequest('phone must be a valid E.164 number (e.g. +919876543210)');
  }

  return {
    event: { ...body, phone },
    checkoutKey,
    phone,
    fireAfter: parseFireAfter(body.fire_after),
  };
}

export async function ingestRecoverAgentAbandonedCheckout(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string | null;
  body: RecoverAgentAbandonedCheckoutEvent;
}): Promise<void> {
  const { event, checkoutKey, phone, fireAfter } =
    validateRecoverAgentAbandonedCheckoutEvent(args.body);

  const ownerUserId = await resolveOwnerUserId(
    args.db,
    args.accountId,
    args.ownerUserId,
  );

  const contact = await ensureShopifyContact(
    args.db,
    args.accountId,
    ownerUserId,
    phone,
    event.customer_name?.trim() || phone,
  );
  if (!contact) {
    throw badRequest('Could not create or resolve a contact for this phone number');
  }

  const payload: RecoverAgentMirrorPayload = {
    [RECOVER_AGENT_MIRROR_PAYLOAD_KEY]: true,
    event,
  };

  const { error } = await args.db.from('shopify_pending_checkouts').upsert(
    {
      account_id: args.accountId,
      checkout_id: checkoutKey,
      contact_id: contact.id,
      payload,
      status: 'pending',
      run_at: fireAfter.toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,checkout_id' },
  );

  if (error) {
    console.error('[api/v1/events/abandoned-checkout] queue failed:', error);
    throw badRequest('Failed to queue abandoned checkout event');
  }
}

export async function processRecoverAgentAbandonedCheckout(args: {
  db: SupabaseClient;
  accountId: string;
  event: RecoverAgentAbandonedCheckoutEvent;
  contactId?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const { event, checkoutKey, phone } = validateRecoverAgentAbandonedCheckoutEvent(
    args.event,
  );

  const ownerUserId = await resolveOwnerUserId(args.db, args.accountId, null);

  const contact =
    args.contactId != null
      ? { id: args.contactId, phone, name: event.customer_name ?? phone }
      : await ensureShopifyContact(
          args.db,
          args.accountId,
          ownerUserId,
          phone,
          event.customer_name?.trim() || phone,
        );

  if (!contact) {
    return { ok: false, reason: 'no_contact' };
  }

  const conversation = await ensureConversation(
    args.db,
    args.accountId,
    ownerUserId,
    contact.id,
  );
  if (!conversation) {
    return { ok: false, reason: 'no_conversation' };
  }

  const context = contextFromRecoverAgentEvent(event);
  const vars = flowVarsFromRecoverAgentEvent(event);

  const flowOutcome = await runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: 'shopify_checkout_app_abandoned',
    contactId: contact.id,
    conversationId: conversation.id,
    context: { vars },
  });

  const flowStarted = flowOutcome.started.length > 0;
  const campaign = await loadCampaign(args.db, args.accountId, 'abandoned_checkout');
  const campaignEnabled = !!(campaign?.is_enabled && campaign.template_name);

  let campaignOk = false;
  if (campaignEnabled) {
    const result = await sendShopifyCampaign({
      db: args.db,
      accountId: args.accountId,
      ownerUserId,
      campaign,
      context,
    });
    campaignOk = result.ok || result.error === 'already sent';
  }

  await deleteConversationIfEmpty(args.db, conversation.id, {
    accountId: args.accountId,
    contactId: contact.id,
  });

  if (flowStarted || campaignOk) {
    return { ok: true };
  }

  if (flowOutcome.no_active_flows && !campaignEnabled) {
    return { ok: false, reason: 'no_handlers_enabled' };
  }

  return { ok: false, reason: 'handlers_skipped' };
}
