import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowRunRow } from '@/lib/flows/types';
import { decrypt } from '@/lib/whatsapp/encryption';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';
import { fetchOrderPaymentState, markOrderAsPaid } from './admin-api';
import { normalizeShopDomain } from './normalize-shop';
import {
  draftInputFor,
  quotePaise,
  recoveryCheckoutInput,
  type RecoveryPaymentMethod,
} from './recovery-checkout-input';

export interface RecoveryOrder {
  id: string;
  account_id: string;
  checkout_id: string;
  contact_id: string;
  status: string;
  draft_order_id: string | null;
  shopify_order_id: string | null;
  order_name: string | null;
  amount_paise: number;
  summary: string;
  quote_fingerprint: string;
  quoted_at: string | null;
  reserved_until: string | null;
  confirmed_at: string | null;
  confirmed_flow_run_id: string | null;
  payment_request_id: string | null;
}

interface Draft {
  id: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  order: { id: string; name: string } | null;
  lineItems: {
    nodes: Array<{
      title: string;
      quantity: number;
      variant: { id: string } | null;
      customAttributes?: Array<{ key: string; value: string | null }>;
    }>;
  };
  shippingAddress: {
    firstName: string | null;
    lastName: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;
}

export const RECOVERY_DRAFT_FIELDS = `id totalPriceSet { shopMoney { amount currencyCode } } order { id name }
  lineItems(first: 50) { nodes { title quantity variant { id } customAttributes { key value } } }
  shippingAddress { firstName lastName address1 address2 city province zip countryCodeV2 phone }`;
export const RECOVERY_DRAFT_CREATE = `mutation RecoveryDraft($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) { draftOrder { ${RECOVERY_DRAFT_FIELDS} } userErrors { message } }
}`;
export const RECOVERY_DRAFT_GET = `query RecoveryDraftLookup($id: ID!) { draftOrder(id: $id) { ${RECOVERY_DRAFT_FIELDS} } }`;
export const RECOVERY_DRAFT_COMPLETE = `mutation CompleteRecoveryDraft($id: ID!) {
  draftOrderComplete(id: $id) { draftOrder { ${RECOVERY_DRAFT_FIELDS} } userErrors { message } }
}`;
/** Separate from the draft fields: reading terms needs read_payment_terms (COD only). */
export const RECOVERY_DRAFT_TERMS = `query RecoveryDraftTerms($id: ID!) { draftOrder(id: $id) { paymentTerms { id } } }`;
export const RECOVERY_PAYMENT_TERMS = `query RecoveryPaymentTerms { paymentTermsTemplates(paymentTermsType: FULFILLMENT) { id } }`;
export const RECOVERY_CUSTOMER = `query RecoveryCustomer($query: String!) { customers(first: 10, query: $query) { nodes { id defaultPhoneNumber { phoneNumber } defaultEmailAddress { emailAddress } } } }`;
export const RECOVERY_CUSTOMER_CREATE = `mutation RecoveryCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) { customer { id } userErrors { message } }
}`;
export const RECOVERY_RECENT_ORDERS = `query RecoveryRecentOrders($query: String!) {
  orders(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id phone cancelledAt shippingAddress { phone } }
    pageInfo { hasNextPage }
  }
}`;
export const RECOVERY_INVENTORY = `query RecoveryInventory($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity inventoryPolicy inventoryItem { tracked } product { status } } }
}`;
export const RECOVERY_RESERVE = `mutation ReserveRecoveryDraft($id: ID!, $input: DraftOrderInput!) {
  draftOrderUpdate(id: $id, input: $input) { draftOrder { ${RECOVERY_DRAFT_FIELDS} } userErrors { message } }
}`;

async function connection(db: SupabaseClient, accountId: string) {
  const { data, error } = await db
    .from('shopify_config')
    .select('shop_domain,access_token,status')
    .eq('account_id', accountId)
    .single();
  if (error || data?.status !== 'connected')
    throw new Error('Connect Shopify before recovering orders.');
  const domain = normalizeShopDomain(data.shop_domain);
  if (!domain) throw new Error('Invalid Shopify store.');
  return { domain, token: decrypt(data.access_token) };
}

async function gql<T>(
  c: { domain: string; token: string },
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `https://${c.domain}/admin/api/2026-10/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': c.token,
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    }
  );
  if (!response.ok)
    throw new Error(`Shopify recovery request failed (${response.status}).`);
  const body = await response.json();
  if (body.errors?.length)
    throw new Error(
      body.errors.map((e: { message: string }) => e.message).join('; ')
    );
  return body.data as T;
}

function draftFromResult(
  result:
    | { draftOrder: Draft | null; userErrors: Array<{ message: string }> }
    | undefined
): Draft {
  if (result?.userErrors.length)
    throw new Error(result.userErrors.map((e) => e.message).join('; '));
  if (!result?.draftOrder)
    throw new Error('Shopify did not return the recovery draft.');
  return result.draftOrder;
}

async function load(
  db: SupabaseClient,
  run: FlowRunRow
): Promise<RecoveryOrder | null> {
  const checkoutId = String(run.vars.checkout_id ?? '').trim();
  if (!checkoutId || !run.contact_id)
    throw new Error('Checkout recovery requires a checkout ID and customer.');
  const { data, error } = await db
    .from('shopify_checkout_recoveries')
    .select('*')
    .eq('account_id', run.account_id)
    .eq('checkout_id', checkoutId)
    .maybeSingle();
  if (error) throw error;
  if (data && data.contact_id !== run.contact_id)
    throw new Error('This checkout belongs to another customer.');
  return data as RecoveryOrder | null;
}

async function checkout(db: SupabaseClient, run: FlowRunRow) {
  const { data: queued, error } = await db
    .from('shopify_pending_checkouts')
    .select('payload,created_at,contact_id,status')
    .eq('account_id', run.account_id)
    .eq('checkout_id', String(run.vars.checkout_id ?? ''))
    .maybeSingle();
  if (error || !queued || queued.status === 'cancelled')
    throw new Error('An active saved checkout is required.');
  if (queued.contact_id && queued.contact_id !== run.contact_id)
    throw new Error('Checkout customer does not match.');
  const input = recoveryCheckoutInput(queued.payload);
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('phone')
    .eq('id', run.contact_id)
    .eq('account_id', run.account_id)
    .single();
  if (contactError || !input.phone || !phonesMatch(input.phone, contact.phone))
    throw new Error('Checkout customer phone does not match.');
  const c = await connection(db, run.account_id);
  // Fail closed if the live order lookup fails. This catches purchases made after the reminder.
  const recent = await gql<{
    orders: {
      nodes: Array<{
        phone: string | null;
        cancelledAt: string | null;
        shippingAddress: { phone: string | null } | null;
      }>;
      pageInfo: { hasNextPage: boolean };
    };
  }>(c, RECOVERY_RECENT_ORDERS, {
    query: `created_at:>=${new Date(queued.created_at).toISOString()}`,
  });
  if (recent.orders.pageInfo.hasNextPage)
    throw new Error(
      'Recent purchase history needs review. Continue on checkout.'
    );
  if (
    recent.orders.nodes.some(
      (o) =>
        !o.cancelledAt &&
        [o.phone, o.shippingAddress?.phone].some(
          (p) => p && phonesMatch(p, input.phone)
        )
    )
  )
    throw new Error(
      'This customer has already placed an order since this checkout.'
    );
  return { input, c };
}

/** Frees the checkout only while Shopify definitely has no draft for this claim. */
async function releaseClaim(db: SupabaseClient, id: string) {
  await db
    .from('shopify_checkout_recoveries')
    .delete()
    .eq('id', id)
    .eq('status', 'preparing')
    .is('draft_order_id', null);
}

/** Meta caps button-message bodies at 1024 characters; the review step adds its own text. */
export const RECOVERY_SUMMARY_MAX = 900;

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** Visible personalization the customer can check, e.g. "Baby name: Asha". */
function personalization(item: Draft['lineItems']['nodes'][number]) {
  const details = (item.customAttributes ?? [])
    .filter(
      ({ key, value }) =>
        !key.startsWith('_') && !!value?.trim() && !/^https?:\/\//i.test(value)
    )
    .map(({ key, value }) => `${key}: ${value!.trim()}`)
    .join(', ');
  return details ? ` (${clip(details, 200)})` : '';
}

export function recoverySummary(
  draft: Pick<Draft, 'lineItems' | 'shippingAddress'>,
  expectedPaise: number,
  codChargePaise = 0
): string {
  const a = draft.shippingAddress;
  const total = `Total: INR ${(expectedPaise / 100).toFixed(2)}${codChargePaise ? ` (includes INR ${(codChargePaise / 100).toFixed(2)} COD charges)` : ''}`;
  const address = clip(
    `Deliver to: ${[a?.firstName, a?.lastName, a?.address1, a?.address2, a?.city, a?.province, a?.zip].filter(Boolean).join(', ')}`,
    300
  );
  const items = draft.lineItems.nodes.map(
    (item) =>
      `${clip(item.title, 80)} × ${item.quantity}${personalization(item)}`
  );
  const budget = RECOVERY_SUMMARY_MAX - total.length - address.length - 2;
  let shown = items.join(', ');
  for (let count = items.length - 1; shown.length > budget && count > 0; count--) {
    const more = items.length - count;
    shown = `${items.slice(0, count).join(', ')} + ${more} more item${more === 1 ? '' : 's'}`;
  }
  return `${clip(shown, budget)}\n${total}\n${address}`;
}

function checkTotal(draft: Draft, expectedPaise: number) {
  const money = draft.totalPriceSet.shopMoney;
  if (
    money.currencyCode !== 'INR' ||
    Math.round(Number(money.amount) * 100) !== expectedPaise
  )
    throw new Error(
      'Shopify’s current total differs from this checkout. Continue on the checkout page.'
    );
}

function quoteFingerprint(draft: Draft) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        money: draft.totalPriceSet.shopMoney,
        items: draft.lineItems,
        address: draft.shippingAddress,
      })
    )
    .digest('hex');
}

function checkQuote(draft: Draft, recovery: RecoveryOrder) {
  checkTotal(draft, Number(recovery.amount_paise));
  if (quoteFingerprint(draft) !== recovery.quote_fingerprint)
    throw new Error(
      'The order details changed after review. Please use checkout or ask our team for help.'
    );
}

async function checkInventory(
  c: { domain: string; token: string },
  draftInput: Record<string, unknown>
) {
  const items = draftInput.lineItems as Array<{
    variantId: string;
    quantity: number;
  }>;
  const needed = new Map<string, number>();
  for (const item of items)
    needed.set(
      item.variantId,
      (needed.get(item.variantId) ?? 0) + item.quantity
    );
  const result = await gql<{
    nodes: Array<{
      id: string;
      inventoryQuantity: number | null;
      inventoryPolicy: string;
      inventoryItem: { tracked: boolean };
      product: { status: string };
    } | null>;
  }>(c, RECOVERY_INVENTORY, { ids: [...needed.keys()] });
  if (
    result.nodes.some(
      (v) =>
        !v ||
        v.product.status !== 'ACTIVE' ||
        (v.inventoryItem.tracked &&
          v.inventoryPolicy === 'DENY' &&
          (v.inventoryQuantity === null ||
            v.inventoryQuantity < needed.get(v.id)!))
    )
  )
    throw new Error('An item is unavailable. Please review your checkout.');
}

type ShopifyConnection = { domain: string; token: string };

/**
 * Finds the checkout's Shopify customer by phone, then by email, like Shopify's
 * own checkout. Returning customers often have the email but a different phone.
 */
async function findCustomer(
  c: ShopifyConnection,
  phone: string,
  email: string
): Promise<string | undefined> {
  const queries = [
    `phone:${JSON.stringify(phone)}`,
    ...(email ? [`email:${JSON.stringify(email)}`] : []),
  ];
  for (const query of queries) {
    const found = await gql<{
      customers: {
        nodes: Array<{
          id: string;
          defaultPhoneNumber: { phoneNumber: string } | null;
          defaultEmailAddress: { emailAddress: string } | null;
        }>;
      };
    }>(c, RECOVERY_CUSTOMER, { query });
    const match = found.customers.nodes.find(
      (v) =>
        (v.defaultPhoneNumber &&
          phonesMatch(v.defaultPhoneNumber.phoneNumber, phone)) ||
        (!!email &&
          v.defaultEmailAddress?.emailAddress?.toLowerCase() ===
            email.toLowerCase())
    );
    if (match) return match.id;
  }
  return undefined;
}

/**
 * COD orders stay unpaid until delivery through "due on fulfillment" terms.
 * Setting terms needs the write_payment_terms permission; prepaid drafts skip it.
 */
async function codPaymentTerms(c: ShopifyConnection) {
  const terms = await gql<{ paymentTermsTemplates: Array<{ id: string }> }>(
    c,
    RECOVERY_PAYMENT_TERMS,
    {}
  );
  if (!terms.paymentTermsTemplates[0]?.id)
    throw new Error(
      'Shopify payment terms are unavailable. Continue on checkout.'
    );
  return {
    paymentTerms: { paymentTermsTemplateId: terms.paymentTermsTemplates[0].id },
  };
}

async function customerAndTerms(
  c: ShopifyConnection,
  input: ReturnType<typeof recoveryCheckoutInput>,
  method: RecoveryPaymentMethod
) {
  const phone = `+${input.phone.replace(/\D/g, '')}`;
  const email = String(input.draftInput.email ?? '').trim();
  let customerId = await findCustomer(c, phone, email);
  if (!customerId) {
    const address = input.draftInput.shippingAddress as Record<string, string>;
    const result = await gql<{
      customerCreate: {
        customer: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(c, RECOVERY_CUSTOMER_CREATE, {
      input: {
        phone,
        firstName: address.firstName,
        lastName: address.lastName,
        ...(email ? { email } : {}),
      },
    });
    customerId = result.customerCreate.customer?.id;
    // "Already taken" means the customer exists but search missed them
    // (e.g. a phone stored in another format, or search indexing delay).
    if (!customerId) customerId = await findCustomer(c, phone, email);
    if (!customerId)
      // Shopify's text goes in cause: the message decides checkout-link routing.
      throw new Error('The checkout customer could not be linked in Shopify.', {
        cause: result.customerCreate.userErrors
          .map((e) => e.message)
          .join('; '),
      });
  }
  const purchasingEntity = { customerId };
  if (method !== 'cod') return { purchasingEntity };
  return { purchasingEntity, ...(await codPaymentTerms(c)) };
}

export async function prepareRecoveryOrder(
  db: SupabaseClient,
  run: FlowRunRow,
  method: RecoveryPaymentMethod,
  reserveUntil?: string
): Promise<RecoveryOrder> {
  const existing = await load(db, run);
  if (existing?.shopify_order_id)
    throw new Error('This checkout already has a recovered order.');
  if (existing?.payment_request_id)
    throw new Error('Payment has already been requested for this checkout.');
  if (existing && existing.status !== 'quoted')
    throw new Error('Checkout completion is already in progress.');
  const { input, c } = await checkout(db, run);
  if (
    !existing?.reserved_until ||
    Date.parse(existing.reserved_until) <= Date.now()
  )
    await checkInventory(c, input.draftInput);
  const reserveInventoryUntil =
    reserveUntil ?? new Date(Date.now() + 15 * 60_000).toISOString();
  // COD and prepaid can cost different amounts (e.g. Fastrr's COD charge).
  const expectedPaise = quotePaise(input, method);
  const draftInput = draftInputFor(input, method);
  const codChargePaise = method === 'cod' ? input.codChargePaise : 0;
  if (existing?.draft_order_id) {
    if (
      !existing.quoted_at ||
      Date.now() - Date.parse(existing.quoted_at) > 15 * 60_000
    )
      throw new Error(
        'The order quote has expired. Continue on the checkout page.'
      );
    const live = await gql<{ draftOrder: Draft | null }>(
      c,
      RECOVERY_DRAFT_GET,
      { id: existing.draft_order_id }
    );
    if (!live.draftOrder || live.draftOrder.order)
      throw new Error('This checkout is no longer available.');
    checkQuote(live.draftOrder, existing);
    if (Number(existing.amount_paise) !== expectedPaise) {
      // The customer switched payment method: re-price the same draft.
      const repriced = await gql<{
        draftOrderUpdate: {
          draftOrder: Draft | null;
          userErrors: Array<{ message: string }>;
        };
      }>(c, RECOVERY_RESERVE, {
        id: existing.draft_order_id,
        input: {
          lineItems: draftInput.lineItems,
          shippingLine: draftInput.shippingLine,
          reserveInventoryUntil,
          // A draft first quoted for UPI has no terms; COD needs them.
          ...(method === 'cod' ? await codPaymentTerms(c) : {}),
        },
      });
      const draft = draftFromResult(repriced.draftOrderUpdate);
      checkTotal(draft, expectedPaise);
      const { data: requoted, error: requoteError } = await db
        .from('shopify_checkout_recoveries')
        .update({
          amount_paise: expectedPaise,
          summary: recoverySummary(draft, expectedPaise, codChargePaise),
          quote_fingerprint: quoteFingerprint(draft),
          quoted_at: new Date().toISOString(),
          reserved_until: reserveInventoryUntil,
          // A COD confirmation does not carry over to the new price.
          confirmed_at: null,
          confirmed_flow_run_id: null,
        })
        .eq('id', existing.id)
        .eq('status', 'quoted')
        .is('payment_request_id', null)
        .select('*')
        .maybeSingle();
      if (requoteError) throw requoteError;
      if (!requoted)
        throw new Error('This checkout is already being completed.');
      return requoted as RecoveryOrder;
    }
    checkTotal(live.draftOrder, expectedPaise);
    const updated = await gql<{
      draftOrderUpdate: {
        draftOrder: Draft | null;
        userErrors: Array<{ message: string }>;
      };
    }>(c, RECOVERY_RESERVE, {
      id: existing.draft_order_id,
      input: { reserveInventoryUntil },
    });
    checkQuote(draftFromResult(updated.draftOrderUpdate), existing);
    const { error: reserveError } = await db
      .from('shopify_checkout_recoveries')
      .update({ reserved_until: reserveInventoryUntil })
      .eq('id', existing.id);
    if (reserveError) throw reserveError;
    return { ...existing, reserved_until: reserveInventoryUntil };
  }
  if (existing)
    throw new Error(
      'Checkout preparation is already in progress. Please use the checkout page.'
    );
  const { data: claimed, error: claimError } = await db
    .from('shopify_checkout_recoveries')
    .insert({
      account_id: run.account_id,
      checkout_id: String(run.vars.checkout_id),
      contact_id: run.contact_id,
      amount_paise: expectedPaise,
      status: 'preparing',
    })
    .select('*')
    .single();
  if (claimError)
    throw new Error('Another recovery is already preparing this checkout.');
  let paymentTerms: Awaited<ReturnType<typeof customerAndTerms>>;
  try {
    paymentTerms = await customerAndTerms(c, input, method);
  } catch (error) {
    await releaseClaim(db, claimed.id);
    throw error;
  }
  // Never repeat an ambiguous create: the unique row remains as a reconciliation marker.
  const created = await gql<{
    draftOrderCreate: {
      draftOrder: Draft | null;
      userErrors: Array<{ message: string }>;
    };
  }>(c, RECOVERY_DRAFT_CREATE, {
    input: {
      ...draftInput,
      ...paymentTerms,
      reserveInventoryUntil,
      tags: ['whatsapp-recovery', `wa-recovery-${claimed.id}`],
      note: `WhatsApp recovery reference: ${claimed.id}`,
    },
  });
  // Shopify validation errors mean no draft exists, so the checkout can be retried.
  if (created.draftOrderCreate?.userErrors.length)
    await releaseClaim(db, claimed.id);
  const draft = draftFromResult(created.draftOrderCreate);
  const { error: saved } = await db
    .from('shopify_checkout_recoveries')
    .update({ draft_order_id: draft.id })
    .eq('id', claimed.id);
  if (saved) throw saved;
  checkTotal(draft, expectedPaise);
  if (!draft.shippingAddress)
    throw new Error('Shopify did not return the shipping address.');
  const summary = recoverySummary(draft, expectedPaise, codChargePaise);
  const { data: result, error: updateError } = await db
    .from('shopify_checkout_recoveries')
    .update({
      status: 'quoted',
      summary,
      quote_fingerprint: quoteFingerprint(draft),
      quoted_at: new Date().toISOString(),
      reserved_until: reserveInventoryUntil,
    })
    .eq('id', claimed.id)
    .select('*')
    .single();
  if (updateError) throw updateError;
  return result as RecoveryOrder;
}

/** Called only after an actual WhatsApp button reply, never from text or trigger variables. */
export async function confirmRecoveryCod(db: SupabaseClient, run: FlowRunRow) {
  const recovery = await load(db, run);
  if (
    !recovery ||
    recovery.id !== run.vars.checkout_recovery_id ||
    recovery.summary !== run.vars.checkout_order_summary ||
    recovery.status !== 'quoted' ||
    recovery.payment_request_id
  )
    throw new Error('Review the COD order before confirming.');
  const { data: confirmed, error } = await db
    .from('shopify_checkout_recoveries')
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_flow_run_id: run.id,
    })
    .eq('id', recovery.id)
    .eq('status', 'quoted')
    .is('payment_request_id', null)
    .select('id')
    .maybeSingle();
  if (error || !confirmed)
    throw new Error('This checkout is already being completed.');
}

export async function completeRecoveryOrder(
  db: SupabaseClient,
  recoveryId: string,
  accountId: string,
  args: { run?: FlowRunRow; paymentRequestId?: string }
): Promise<RecoveryOrder> {
  const { data, error } = await db
    .from('shopify_checkout_recoveries')
    .select('*')
    .eq('id', recoveryId)
    .eq('account_id', accountId)
    .single();
  if (error) throw error;
  const recovery = data as RecoveryOrder;
  if (!recovery.draft_order_id)
    throw new Error('The checkout draft is unavailable.');
  const prepaid = !!args.paymentRequestId;
  let currentRun = args.run;
  if (prepaid) {
    const { data: payment, error: paymentError } = await db
      .from('flow_payment_requests')
      .select('status,amount_paise,flow_run_id')
      .eq('id', args.paymentRequestId)
      .eq('account_id', accountId)
      .eq('checkout_recovery_id', recovery.id)
      .single();
    if (
      paymentError ||
      payment?.status !== 'paid' ||
      Number(payment.amount_paise) !== Number(recovery.amount_paise) ||
      recovery.payment_request_id !== args.paymentRequestId
    )
      throw new Error('Verified payment for this checkout is required.');
    const { data: paidRun, error: runError } = await db
      .from('flow_runs')
      .select('*')
      .eq('id', payment.flow_run_id)
      .eq('account_id', accountId)
      .single();
    if (runError) throw runError;
    currentRun = paidRun as FlowRunRow;
  } else {
    if (
      !args.run ||
      recovery.confirmed_flow_run_id !== args.run.id ||
      !recovery.confirmed_at ||
      Date.now() - Date.parse(recovery.confirmed_at) > 15 * 60_000
    )
      throw new Error(
        'Tap the COD confirmation button after reviewing the order.'
      );
    if (recovery.payment_request_id)
      throw new Error('This checkout already has a payment request.');
    if (recovery.status === 'quoted') {
      const { data: claim, error: claimError } = await db
        .from('shopify_checkout_recoveries')
        .update({ status: 'completing' })
        .eq('id', recovery.id)
        .eq('status', 'quoted')
        .is('payment_request_id', null)
        .select('id')
        .maybeSingle();
      if (claimError || !claim)
        throw new Error('Another request is already completing this checkout.');
    }
  }
  const c = await connection(db, accountId);
  const live = await gql<{ draftOrder: Draft | null }>(c, RECOVERY_DRAFT_GET, {
    id: recovery.draft_order_id,
  });
  if (!live.draftOrder) throw new Error('The Shopify draft is unavailable.');
  checkQuote(live.draftOrder, recovery);
  let order = live.draftOrder.order;
  if (!order) {
    if (
      !currentRun ||
      currentRun.contact_id !== recovery.contact_id ||
      String(currentRun.vars.checkout_id) !== recovery.checkout_id
    )
      throw new Error('Checkout order ownership could not be verified.');
    const fresh = await checkout(db, currentRun);
    if (
      quotePaise(fresh.input, prepaid ? 'prepaid' : 'cod') !==
      Number(recovery.amount_paise)
    )
      throw new Error(
        'The order details changed after review. Please use checkout or ask our team for help.'
      );
    if (
      !recovery.reserved_until ||
      Date.parse(recovery.reserved_until) <= Date.now()
    )
      await checkInventory(fresh.c, fresh.input.draftInput);
    if (
      !prepaid &&
      (!recovery.quoted_at ||
        Date.now() - Date.parse(recovery.quoted_at) > 15 * 60_000)
    )
      throw new Error('The COD quote expired. Continue on checkout.');
    const method = prepaid ? 'Prepaid' : 'Cash on Delivery';
    const labelled = await gql<{
      draftOrderUpdate: {
        draftOrder: Draft | null;
        userErrors: Array<{ message: string }>;
      };
    }>(c, RECOVERY_RESERVE, {
      id: recovery.draft_order_id,
      input: {
        tags: [
          'whatsapp-recovery',
          `wa-recovery-${recovery.id}`,
          prepaid ? 'whatsapp-prepaid' : 'whatsapp-cod',
        ],
        customAttributes: [
          { key: 'WhatsApp payment method', value: method },
          { key: 'WhatsApp recovery reference', value: recovery.id },
          ...(prepaid
            ? [
                {
                  key: 'WhatsApp payment reference',
                  value: args.paymentRequestId,
                },
              ]
            : []),
        ],
      },
    });
    checkQuote(draftFromResult(labelled.draftOrderUpdate), recovery);
    if (!prepaid) {
      // Completing a draft without terms records it as paid: never for COD.
      const terms = await gql<{
        draftOrder: { paymentTerms: { id: string } | null } | null;
      }>(c, RECOVERY_DRAFT_TERMS, { id: recovery.draft_order_id });
      if (!terms.draftOrder?.paymentTerms)
        throw new Error(
          'COD payment terms are missing on the Shopify draft. Please use checkout or ask our team for help.'
        );
    }
    // Completion is bound to one Shopify draft. Retrying reads its existing order.
    const result = await gql<{
      draftOrderComplete: {
        draftOrder: Draft | null;
        userErrors: Array<{ message: string }>;
      };
    }>(c, RECOVERY_DRAFT_COMPLETE, { id: recovery.draft_order_id });
    order = draftFromResult(result.draftOrderComplete).order;
  }
  if (!order) throw new Error('Shopify has not finished creating the order.');
  const orderId = order.id.replace('gid://shopify/Order/', '');
  if (prepaid) {
    const state = await fetchOrderPaymentState(c.domain, c.token, orderId);
    if (
      !state ||
      state.cancelled ||
      state.currency !== 'INR' ||
      Math.round(Number(state.outstanding) * 100) >
        Number(recovery.amount_paise)
    )
      throw new Error('The paid order needs manual review in Shopify.');
    if (Number(state.outstanding) > 0) {
      if (!state.canMarkAsPaid)
        throw new Error('Shopify cannot record this payment yet.');
      await markOrderAsPaid(c.domain, c.token, orderId);
    }
  }
  const { data: placed, error: placedError } = await db
    .from('shopify_checkout_recoveries')
    .update({
      status: 'placed',
      shopify_order_id: orderId,
      order_name: order.name,
    })
    .eq('id', recovery.id)
    .select('*')
    .single();
  if (placedError) throw placedError;
  await db
    .from('shopify_pending_checkouts')
    .update({ status: 'cancelled', error_message: 'recovered_order_placed' })
    .eq('account_id', accountId)
    .eq('checkout_id', recovery.checkout_id)
    .eq('status', 'pending');
  return placed as RecoveryOrder;
}
