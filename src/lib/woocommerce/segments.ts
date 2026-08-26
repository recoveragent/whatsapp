import {
  WOO_HIGH_VALUE_THRESHOLD,
  WOO_INACTIVE_DAYS,
  WOO_RECENT_DAYS,
} from './customer-tags';

export type WooCommerceSegmentKey =
  | 'all_customers'
  | 'repeat_buyers'
  | 'one_time_buyers'
  | 'never_ordered'
  | 'recent_30d'
  | 'inactive_90d'
  | 'high_value'
  | 'cod_customers';

export interface WooCommerceSegmentDefinition {
  key: WooCommerceSegmentKey;
  label: string;
  description: string;
}

export const WOOCOMMERCE_SEGMENTS: WooCommerceSegmentDefinition[] = [
  {
    key: 'all_customers',
    label: 'All WooCommerce customers',
    description: 'Every synced customer with a phone number',
  },
  {
    key: 'repeat_buyers',
    label: 'Repeat buyers',
    description: 'Customers with 2 or more orders',
  },
  {
    key: 'one_time_buyers',
    label: 'One-time buyers',
    description: 'Customers with exactly one order',
  },
  {
    key: 'never_ordered',
    label: 'Registered, never ordered',
    description: 'Synced customers with zero orders',
  },
  {
    key: 'recent_30d',
    label: 'Ordered in last 30 days',
    description: 'Recent purchasers for re-engagement or upsell',
  },
  {
    key: 'inactive_90d',
    label: 'Inactive 90+ days',
    description: 'No order in the last 90 days — win-back audience',
  },
  {
    key: 'high_value',
    label: `High value (₹${WOO_HIGH_VALUE_THRESHOLD.toLocaleString()}+ LTV)`,
    description: 'Lifetime spend above threshold',
  },
  {
    key: 'cod_customers',
    label: 'COD customers',
    description: 'Most recent payment method was cash on delivery',
  },
];

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Filter shape applied when querying woocommerce_customer_stats. */
export function segmentFilterForKey(segment: WooCommerceSegmentKey): {
  order_count?: { op: 'eq' | 'gte'; value: number };
  last_order_at?: { op: 'gte' | 'lt'; value: string };
  total_spend?: { op: 'gte'; value: number };
  preferred_payment_gateway?: { op: 'ilike'; value: string };
} {
  switch (segment) {
    case 'all_customers':
      return {};
    case 'repeat_buyers':
      return { order_count: { op: 'gte', value: 2 } };
    case 'one_time_buyers':
      return { order_count: { op: 'eq', value: 1 } };
    case 'never_ordered':
      return { order_count: { op: 'eq', value: 0 } };
    case 'recent_30d':
      return { last_order_at: { op: 'gte', value: daysAgoIso(WOO_RECENT_DAYS) } };
    case 'inactive_90d':
      return { last_order_at: { op: 'lt', value: daysAgoIso(WOO_INACTIVE_DAYS) } };
    case 'high_value':
      return { total_spend: { op: 'gte', value: WOO_HIGH_VALUE_THRESHOLD } };
    case 'cod_customers':
      return { preferred_payment_gateway: { op: 'ilike', value: '%cod%' } };
    default:
      return {};
  }
}
