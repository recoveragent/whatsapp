import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact } from '@/types';

import { segmentFilterForKey, type WooCommerceSegmentKey } from './segments';

export async function resolveWooCommerceSegmentContactIds(
  supabase: SupabaseClient,
  segment: WooCommerceSegmentKey,
): Promise<string[]> {
  const filter = segmentFilterForKey(segment);

  let query = supabase.from('woocommerce_customer_stats').select('contact_id');

  if (filter.order_count) {
    if (filter.order_count.op === 'eq') {
      query = query.eq('order_count', filter.order_count.value);
    } else {
      query = query.gte('order_count', filter.order_count.value);
    }
  }

  if (filter.last_order_at) {
    if (filter.last_order_at.op === 'gte') {
      query = query.gte('last_order_at', filter.last_order_at.value);
    } else {
      query = query.lt('last_order_at', filter.last_order_at.value);
    }
  }

  if (filter.total_spend) {
    query = query.gte('total_spend', filter.total_spend.value);
  }

  if (filter.preferred_payment_gateway) {
    query = query.ilike(
      'preferred_payment_gateway',
      filter.preferred_payment_gateway.value,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to resolve WooCommerce segment: ${error.message}`);

  return [...new Set((data ?? []).map((row) => row.contact_id as string))];
}

export async function resolveWooCommerceSegmentContacts(
  supabase: SupabaseClient,
  segment: WooCommerceSegmentKey,
): Promise<Contact[]> {
  const contactIds = await resolveWooCommerceSegmentContactIds(supabase, segment);
  if (contactIds.length === 0) return [];

  const contacts: Contact[] = [];
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data, error } = await supabase.from('contacts').select('*').in('id', slice);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
  }

  return contacts;
}

export async function countWooCommerceSegment(
  supabase: SupabaseClient,
  segment: WooCommerceSegmentKey,
): Promise<number> {
  const filter = segmentFilterForKey(segment);

  let query = supabase
    .from('woocommerce_customer_stats')
    .select('*', { count: 'exact', head: true });

  if (filter.order_count) {
    if (filter.order_count.op === 'eq') {
      query = query.eq('order_count', filter.order_count.value);
    } else {
      query = query.gte('order_count', filter.order_count.value);
    }
  }

  if (filter.last_order_at) {
    if (filter.last_order_at.op === 'gte') {
      query = query.gte('last_order_at', filter.last_order_at.value);
    } else {
      query = query.lt('last_order_at', filter.last_order_at.value);
    }
  }

  if (filter.total_spend) {
    query = query.gte('total_spend', filter.total_spend.value);
  }

  if (filter.preferred_payment_gateway) {
    query = query.ilike(
      'preferred_payment_gateway',
      filter.preferred_payment_gateway.value,
    );
  }

  const { count, error } = await query;
  if (error) throw new Error(`Failed to count WooCommerce segment: ${error.message}`);
  return count ?? 0;
}
