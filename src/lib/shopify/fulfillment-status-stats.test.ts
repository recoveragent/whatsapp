import { describe, expect, it } from 'vitest';

import {
  FULFILLMENT_STATUS_NONE_KEY,
  buildRecommendedFulfillmentTriggerConfig,
  fetchFulfillmentStatusStats,
  labelForFulfillmentStatusKey,
} from './fulfillment-status-stats';
import { SHOPIFY_SHIPMENT_NONE_KEY } from '@/lib/flows/trigger-types';

describe('labelForFulfillmentStatusKey', () => {
  it('labels missing status for initial fulfillments', () => {
    expect(labelForFulfillmentStatusKey(FULFILLMENT_STATUS_NONE_KEY)).toEqual({
      label: 'No status (initial fulfill)',
      known: false,
    });
  });

  it('labels known Shopify statuses', () => {
    expect(labelForFulfillmentStatusKey('in_transit')).toEqual({
      label: 'In transit',
      known: true,
    });
  });
});

describe('fetchFulfillmentStatusStats', () => {
  it('aggregates counts by normalized status', async () => {
    const rows = [
      { shipment_status: null, received_at: '2026-08-23T10:00:00Z' },
      { shipment_status: null, received_at: '2026-08-22T10:00:00Z' },
      { shipment_status: 'in_transit', received_at: '2026-08-21T10:00:00Z' },
    ];

    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              order: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    };

    const stats = await fetchFulfillmentStatusStats({
      db: db as never,
      accountId: 'acc-1',
      days: 7,
    });

    expect(stats.total_events).toBe(3);
    expect(stats.statuses).toEqual([
      expect.objectContaining({
        status: FULFILLMENT_STATUS_NONE_KEY,
        count: 2,
      }),
      expect.objectContaining({
        status: 'in_transit',
        count: 1,
      }),
    ]);
  });
});

describe('buildRecommendedFulfillmentTriggerConfig', () => {
  it('selects none, out_for_delivery, and delivered when present in stats', () => {
    const config = buildRecommendedFulfillmentTriggerConfig(
      {
        days: 7,
        total_events: 94,
        statuses: [
          { status: 'out_for_delivery', label: 'Out for delivery', count: 78, last_seen: 'x', known: true },
          { status: FULFILLMENT_STATUS_NONE_KEY, label: 'No status', count: 13, last_seen: 'x', known: false },
          { status: 'delivered', label: 'Delivered', count: 3, last_seen: 'x', known: true },
        ],
      },
      { payment_status: 'any' },
    );

    expect(config.shipment_statuses).toEqual([
      SHOPIFY_SHIPMENT_NONE_KEY,
      'out_for_delivery',
      'delivered',
    ]);
    expect(config.shipment_routes).toEqual({});
  });
});
