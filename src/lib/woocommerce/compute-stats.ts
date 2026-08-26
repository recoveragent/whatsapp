import type { SupabaseClient } from '@supabase/supabase-js';

import type { WooCommerceCustomerPayload } from './types';

export interface ComputedCustomerStats {
  order_count: number;
  total_spend: number;
  currency: string | null;
  last_order_at: string | null;
  first_order_at: string | null;
  latest_payment_status: string | null;
  preferred_payment_gateway: string | null;
  is_paying_customer: boolean;
}

function parseSpend(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Prefer cached woocommerce_orders for this contact; fall back to Woo
 * aggregate fields on the customer payload when no local orders exist.
 */
export async function computeCustomerStatsFromOrders(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  customer?: WooCommerceCustomerPayload | null,
): Promise<ComputedCustomerStats> {
  const { data: orders } = await db
    .from('woocommerce_orders')
    .select('total_price, currency, payment_status, payment_gateway, ordered_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('ordered_at', { ascending: true });

  const rows = orders ?? [];

  if (rows.length > 0) {
    let totalSpend = 0;
    let currency: string | null = null;
    let firstOrderAt: string | null = null;
    let lastOrderAt: string | null = null;
    let latestPaymentStatus: string | null = null;
    let preferredGateway: string | null = null;
    const gatewayCounts = new Map<string, number>();

    for (const row of rows) {
      totalSpend += parseSpend(row.total_price as string | null);
      if (row.currency) currency = row.currency as string;
      const orderedAt = row.ordered_at as string | null;
      if (orderedAt) {
        if (!firstOrderAt) firstOrderAt = orderedAt;
        lastOrderAt = orderedAt;
      }
      if (row.payment_status) latestPaymentStatus = row.payment_status as string;
      const gateway = row.payment_gateway as string | null;
      if (gateway) {
        gatewayCounts.set(gateway, (gatewayCounts.get(gateway) ?? 0) + 1);
      }
    }

    if (gatewayCounts.size > 0) {
      preferredGateway = [...gatewayCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    }

    return {
      order_count: rows.length,
      total_spend: totalSpend,
      currency,
      last_order_at: lastOrderAt,
      first_order_at: firstOrderAt,
      latest_payment_status: latestPaymentStatus,
      preferred_payment_gateway: preferredGateway,
      is_paying_customer: rows.length > 0,
    };
  }

  const wooOrderCount = customer?.orders_count ?? 0;
  const wooTotalSpent = parseSpend(customer?.total_spent);

  return {
    order_count: wooOrderCount,
    total_spend: wooTotalSpent,
    currency: null,
    last_order_at: null,
    first_order_at: null,
    latest_payment_status: null,
    preferred_payment_gateway: null,
    is_paying_customer: Boolean(customer?.is_paying_customer ?? wooOrderCount > 0),
  };
}
