import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { canonicalContactPhone, normalizePhone } from '@/lib/whatsapp/phone-utils';

import { computeCustomerStatsFromOrders } from './compute-stats';
import {
  WOO_HIGH_VALUE_THRESHOLD,
  WOO_INACTIVE_DAYS,
  WOO_RECENT_DAYS,
  WOO_TAG_NAMES,
  type WooTagName,
} from './customer-tags';
import {
  extractBillingLocation,
  extractCustomerEmail,
  extractCustomerName,
  extractCustomerPhone,
  extractCustomerSince,
} from './extract-customer-context';
import type { WooCommerceCustomerPayload } from './types';

export interface SyncCustomerResult {
  ok: boolean;
  contactId?: string;
  skipped?: 'no_phone' | 'no_customer_id';
  reason?: string;
}

async function findContactByWooId(
  db: SupabaseClient,
  accountId: string,
  wooCustomerId: string,
): Promise<{ id: string; phone: string; name?: string | null } | null> {
  const { data } = await db
    .from('contacts')
    .select('id, phone, name')
    .eq('account_id', accountId)
    .eq('woocommerce_customer_id', wooCustomerId)
    .maybeSingle();

  return data as { id: string; phone: string; name?: string | null } | null;
}

async function findContactByEmail(
  db: SupabaseClient,
  accountId: string,
  email: string,
): Promise<{ id: string; phone: string; name?: string | null } | null> {
  const { data } = await db
    .from('contacts')
    .select('id, phone, name')
    .eq('account_id', accountId)
    .ilike('email', email)
    .limit(1)
    .maybeSingle();

  return data as { id: string; phone: string; name?: string | null } | null;
}

async function ensureWooContact(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  customer: WooCommerceCustomerPayload;
}): Promise<{ id: string; phone: string; name?: string | null } | null> {
  const { db, accountId, ownerUserId, customer } = args;
  if (!customer.id) return null;

  const wooCustomerId = String(customer.id);
  const phoneRaw = extractCustomerPhone(customer);
  const email = extractCustomerEmail(customer);
  const name = extractCustomerName(customer);

  const byWooId = await findContactByWooId(db, accountId, wooCustomerId);
  if (byWooId) {
    const updates: Record<string, string> = { updated_at: new Date().toISOString() };
    if (name && name !== byWooId.name) updates.name = name;
    if (email) updates.email = email;
    if (Object.keys(updates).length > 1) {
      await db.from('contacts').update(updates).eq('id', byWooId.id);
    }
    return byWooId;
  }

  if (!phoneRaw) {
    if (email) {
      const byEmail = await findContactByEmail(db, accountId, email);
      if (byEmail) {
        await db
          .from('contacts')
          .update({
            woocommerce_customer_id: wooCustomerId,
            name: name ?? byEmail.name,
            email,
            updated_at: new Date().toISOString(),
          })
          .eq('id', byEmail.id);
        return byEmail;
      }
    }
    return null;
  }

  const normalized = canonicalContactPhone(normalizePhone(phoneRaw));
  if (!normalized || normalized.length < 8) return null;

  const existing = await findExistingContact(db, accountId, normalized);
  if (existing) {
    await db
      .from('contacts')
      .update({
        woocommerce_customer_id: wooCustomerId,
        name: name ?? existing.name ?? normalized,
        email: email ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    return { id: existing.id, phone: existing.phone, name: name ?? existing.name };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: normalized,
      name: name || normalized,
      email: email ?? null,
      woocommerce_customer_id: wooCustomerId,
    })
    .select('id, phone, name')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, normalized);
      if (raced) {
        await db
          .from('contacts')
          .update({ woocommerce_customer_id: wooCustomerId, updated_at: new Date().toISOString() })
          .eq('id', raced.id);
        return { id: raced.id, phone: raced.phone, name: raced.name };
      }
    }
    console.error('[woocommerce] ensureWooContact failed:', error);
    return null;
  }

  return created;
}

const TAG_COLORS: Record<WooTagName, string> = {
  [WOO_TAG_NAMES.customer]: '#6366f1',
  [WOO_TAG_NAMES.repeatBuyer]: '#10b981',
  [WOO_TAG_NAMES.oneTimeBuyer]: '#f59e0b',
  [WOO_TAG_NAMES.recent30d]: '#06b6d4',
  [WOO_TAG_NAMES.inactive90d]: '#ef4444',
  [WOO_TAG_NAMES.highValue]: '#a855f7',
  [WOO_TAG_NAMES.cod]: '#64748b',
};

async function ensureAccountTag(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  tagName: WooTagName,
): Promise<string | null> {
  const { data: existing } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', tagName)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await db
    .from('tags')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      name: tagName,
      color: TAG_COLORS[tagName] ?? '#6366f1',
    })
    .select('id')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('tags')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', tagName)
        .maybeSingle();
      return (raced?.id as string) ?? null;
    }
    console.error('[woocommerce] ensureAccountTag failed:', tagName, error);
    return null;
  }

  return created?.id as string;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function resolveSegmentTags(stats: {
  order_count: number;
  total_spend: number;
  last_order_at: string | null;
  customer_since: string | null;
  preferred_payment_gateway: string | null;
}): WooTagName[] {
  const tags: WooTagName[] = [WOO_TAG_NAMES.customer];
  const now = new Date();

  if (stats.order_count >= 2) tags.push(WOO_TAG_NAMES.repeatBuyer);
  if (stats.order_count === 1) tags.push(WOO_TAG_NAMES.oneTimeBuyer);

  if (stats.last_order_at) {
    const last = new Date(stats.last_order_at);
    if (last >= daysAgo(WOO_RECENT_DAYS)) tags.push(WOO_TAG_NAMES.recent30d);
    if (last < daysAgo(WOO_INACTIVE_DAYS)) tags.push(WOO_TAG_NAMES.inactive90d);
  } else if (stats.customer_since) {
    const since = new Date(stats.customer_since);
    if (since < daysAgo(WOO_INACTIVE_DAYS)) tags.push(WOO_TAG_NAMES.inactive90d);
  }

  if (stats.total_spend >= WOO_HIGH_VALUE_THRESHOLD) tags.push(WOO_TAG_NAMES.highValue);

  const gateway = stats.preferred_payment_gateway?.toLowerCase() ?? '';
  if (gateway.includes('cod') || gateway.includes('cash on delivery')) {
    tags.push(WOO_TAG_NAMES.cod);
  }

  return tags;
}

async function applyWooSegmentTags(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  contactId: string;
  stats: {
    order_count: number;
    total_spend: number;
    last_order_at: string | null;
    customer_since: string | null;
    preferred_payment_gateway: string | null;
  };
}): Promise<void> {
  const desired = resolveSegmentTags(args.stats);
  const allWooTags = Object.values(WOO_TAG_NAMES);

  const tagIdByName = new Map<WooTagName, string>();
  for (const name of allWooTags) {
    const id = await ensureAccountTag(args.db, args.accountId, args.ownerUserId, name);
    if (id) tagIdByName.set(name, id);
  }

  const desiredIds = new Set(
    desired.map((name) => tagIdByName.get(name)).filter(Boolean) as string[],
  );

  for (const name of allWooTags) {
    const tagId = tagIdByName.get(name);
    if (!tagId) continue;

    if (desiredIds.has(tagId)) {
      await args.db
        .from('contact_tags')
        .upsert(
          { contact_id: args.contactId, tag_id: tagId },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        );
    } else {
      await args.db.from('contact_tags').delete().eq('contact_id', args.contactId).eq('tag_id', tagId);
    }
  }
}

/**
 * Upsert a WooCommerce customer as a CRM contact with purchase stats and segment tags.
 */
export async function syncWooCommerceCustomer(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  customer: WooCommerceCustomerPayload;
  applyTags?: boolean;
}): Promise<SyncCustomerResult> {
  if (!args.customer?.id) {
    return { ok: false, skipped: 'no_customer_id' };
  }

  const phone = extractCustomerPhone(args.customer);
  if (!phone) {
    return { ok: false, skipped: 'no_phone' };
  }

  const contact = await ensureWooContact({
    db: args.db,
    accountId: args.accountId,
    ownerUserId: args.ownerUserId,
    customer: args.customer,
  });

  if (!contact) {
    return { ok: false, reason: 'contact_upsert_failed' };
  }

  const billing = extractBillingLocation(args.customer);
  const customerSince = extractCustomerSince(args.customer);
  const computed = await computeCustomerStatsFromOrders(
    args.db,
    args.accountId,
    contact.id,
    args.customer,
  );

  const { error: statsError } = await args.db.from('woocommerce_customer_stats').upsert(
    {
      account_id: args.accountId,
      contact_id: contact.id,
      woocommerce_customer_id: String(args.customer.id),
      order_count: computed.order_count,
      total_spend: computed.total_spend,
      currency: computed.currency,
      last_order_at: computed.last_order_at,
      first_order_at: computed.first_order_at,
      latest_payment_status: computed.latest_payment_status,
      preferred_payment_gateway: computed.preferred_payment_gateway,
      billing_country: billing.country,
      billing_state: billing.state,
      billing_city: billing.city,
      is_paying_customer: computed.is_paying_customer,
      customer_since: customerSince,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,contact_id' },
  );

  if (statsError) {
    console.error('[woocommerce] syncWooCommerceCustomer stats failed:', statsError);
    return { ok: false, reason: 'stats_upsert_failed', contactId: contact.id };
  }

  if (args.applyTags !== false) {
    await applyWooSegmentTags({
      db: args.db,
      accountId: args.accountId,
      ownerUserId: args.ownerUserId,
      contactId: contact.id,
      stats: {
        order_count: computed.order_count,
        total_spend: computed.total_spend,
        last_order_at: computed.last_order_at,
        customer_since: customerSince,
        preferred_payment_gateway: computed.preferred_payment_gateway,
      },
    });
  }

  return { ok: true, contactId: contact.id };
}

/**
 * Recompute stats + tags for a contact after an order sync.
 */
export async function refreshWooCustomerStatsForContact(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  contactId: string;
  woocommerceCustomerId?: string | null;
}): Promise<void> {
  const { data: contact } = await args.db
    .from('contacts')
    .select('woocommerce_customer_id')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle();

  const wooCustomerId =
    args.woocommerceCustomerId ??
    (contact?.woocommerce_customer_id as string | null | undefined);

  if (!wooCustomerId) return;

  const computed = await computeCustomerStatsFromOrders(
    args.db,
    args.accountId,
    args.contactId,
    null,
  );

  const { data: existing } = await args.db
    .from('woocommerce_customer_stats')
    .select('customer_since, billing_country, billing_state, billing_city')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .maybeSingle();

  await args.db.from('woocommerce_customer_stats').upsert(
    {
      account_id: args.accountId,
      contact_id: args.contactId,
      woocommerce_customer_id: wooCustomerId,
      order_count: computed.order_count,
      total_spend: computed.total_spend,
      currency: computed.currency,
      last_order_at: computed.last_order_at,
      first_order_at: computed.first_order_at,
      latest_payment_status: computed.latest_payment_status,
      preferred_payment_gateway: computed.preferred_payment_gateway,
      is_paying_customer: computed.is_paying_customer,
      billing_country: (existing?.billing_country as string | null) ?? null,
      billing_state: (existing?.billing_state as string | null) ?? null,
      billing_city: (existing?.billing_city as string | null) ?? null,
      customer_since: (existing?.customer_since as string | null) ?? null,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,contact_id' },
  );

  await applyWooSegmentTags({
    db: args.db,
    accountId: args.accountId,
    ownerUserId: args.ownerUserId,
    contactId: args.contactId,
    stats: {
      order_count: computed.order_count,
      total_spend: computed.total_spend,
      last_order_at: computed.last_order_at,
      customer_since: (existing?.customer_since as string | null) ?? null,
      preferred_payment_gateway: computed.preferred_payment_gateway,
    },
  });
}
