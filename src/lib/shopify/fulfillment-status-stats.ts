import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SHOPIFY_SHIPMENT_STATUS_LABELS,
  type ShopifyShipmentStatus,
} from '@/lib/flows/trigger-types';

export const FULFILLMENT_STATUS_NONE_KEY = '__none__';

export interface FulfillmentStatusStatRow {
  /** Normalized status key, or FULFILLMENT_STATUS_NONE_KEY when Shopify sent no status. */
  status: string;
  label: string;
  count: number;
  last_seen: string;
  /** True when this maps to a known Shopify shipment_status enum value. */
  known: boolean;
}

export interface FulfillmentStatusStats {
  days: number;
  total_events: number;
  statuses: FulfillmentStatusStatRow[];
}

export function labelForFulfillmentStatusKey(status: string): {
  label: string;
  known: boolean;
} {
  if (status === FULFILLMENT_STATUS_NONE_KEY) {
    return {
      label: 'No status (initial fulfill)',
      known: false,
    };
  }
  const label =
    SHOPIFY_SHIPMENT_STATUS_LABELS[status as ShopifyShipmentStatus];
  if (label) {
    return { label, known: true };
  }
  return {
    label: status.replace(/_/g, ' '),
    known: false,
  };
}

export function fulfillmentStatusKeyToTriggerSelection(status: string): string | null {
  if (status === FULFILLMENT_STATUS_NONE_KEY) return null;
  return status;
}

export async function fetchFulfillmentStatusStats(args: {
  db: SupabaseClient;
  accountId: string;
  days?: number;
}): Promise<FulfillmentStatusStats> {
  const days = args.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await args.db
    .from('shopify_fulfillment_events')
    .select('shipment_status, received_at')
    .eq('account_id', args.accountId)
    .gte('received_at', since)
    .order('received_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const buckets = new Map<string, { count: number; last_seen: string }>();
  for (const row of data ?? []) {
    const key =
      row.shipment_status == null || row.shipment_status === ''
        ? FULFILLMENT_STATUS_NONE_KEY
        : String(row.shipment_status);
    const receivedAt = String(row.received_at);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { count: 1, last_seen: receivedAt });
      continue;
    }
    existing.count += 1;
    if (receivedAt > existing.last_seen) {
      existing.last_seen = receivedAt;
    }
  }

  const statuses = [...buckets.entries()]
    .map(([status, meta]) => {
      const { label, known } = labelForFulfillmentStatusKey(status);
      return {
        status,
        label,
        count: meta.count,
        last_seen: meta.last_seen,
        known,
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    days,
    total_events: data?.length ?? 0,
    statuses,
  };
}
