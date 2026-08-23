import { describe, expect, it } from 'vitest';

import {
  FULFILLMENT_STATUS_NONE_KEY,
  fetchFulfillmentStatusStats,
  labelForFulfillmentStatusKey,
} from './fulfillment-status-stats';

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
