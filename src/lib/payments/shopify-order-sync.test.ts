import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowRunRow } from '@/lib/flows/types';

const shopify = vi.hoisted(() => ({
  state: vi.fn(),
  markPaid: vi.fn(),
  tags: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('@/lib/shopify/admin-api', () => ({
  fetchOrderPaymentState: shopify.state,
  markOrderAsPaid: shopify.markPaid,
  addOrderTags: shopify.tags,
}));

import {
  codOrderCollection,
  processShopifyOrderSyncs,
  syncShopifyOrderPayment,
} from './shopify-order-sync';

type Row = Record<string, unknown>;

function database(tables: Record<string, Row[]>) {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined;
    let insertion: Row | undefined;
    const execute = () => {
      if (insertion) (tables[table] ??= []).push(insertion);
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r))
      );
      if (patch) rows.forEach((row) => Object.assign(row, patch));
      return { data: structuredClone(rows), error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      not: (k: string, _operator: string, v: unknown) => {
        filters.push((r) => r[k] != null && r[k] !== v);
        return b;
      },
      in: (k: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[k]));
        return b;
      },
      is: (k: string, v: unknown) => {
        filters.push((r) => (r[k] ?? null) === v);
        return b;
      },
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      lte: (k: string, v: string) => {
        filters.push((r) => String(r[k]) <= v);
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      insert: (row: Row) => {
        insertion = row;
        return b;
      },
      maybeSingle: async () => {
        const r = execute();
        return { ...r, data: r.data[0] ?? null };
      },
      then: (resolve: (r: ReturnType<typeof execute>) => unknown) =>
        Promise.resolve(resolve(execute())),
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

function fixture(patch: Row = {}) {
  const tables: Record<string, Row[]> = {
    shopify_config: [
      {
        account_id: 'brand',
        shop_domain: 'demo.myshopify.com',
        access_token: 'token',
        status: 'connected',
      },
    ],
    flow_payment_requests: [
      {
        id: 'request',
        account_id: 'brand',
        flow_run_id: 'run',
        node_key: 'collect',
        amount_paise: 149900,
        status: 'paid',
        config: { shopify_cod_to_prepaid: true, shopify_paid_tag: 'cod-to-prepaid' ,
        },
        shopify_order_id: '5551',
        shopify_sync_status: 'pending',
        shopify_sync_attempts: 0,
        shopify_sync_next_at: new Date(0).toISOString(),
        ...patch,
      },
    ],
    flow_run_events: [],
  };
  return { db: database(tables), tables, row: tables.flow_payment_requests[0] };
}

const unpaid = {
  cancelled: false,
  financialStatus: 'PENDING',
  canMarkAsPaid: true,
  outstanding: '1499.00',
  currency: 'INR',
};

beforeEach(() => {
  shopify.state.mockReset().mockResolvedValue(unpaid);
  shopify.markPaid.mockReset().mockResolvedValue(undefined);
  shopify.tags.mockReset().mockResolvedValue(undefined);
});

describe('COD order amount', () => {
  const run = (vars: Row) =>
    ({ account_id: 'brand', vars }) as unknown as FlowRunRow;

  it('charges the live outstanding balance of the triggering order', async () => {
    const f = fixture();
    await expect(
      codOrderCollection(f.db, run({ shopify_order_id: '5551' }))
    ).resolves.toEqual({ amount: 1499, orderId: '5551' });
    expect(shopify.state).toHaveBeenCalledWith('demo.myshopify.com', 'token', '5551');
  });
  it.each([
    [{ ...unpaid, cancelled: true }, 'cancelled'],
    [{ ...unpaid, outstanding: '0.00', financialStatus: 'PAID' }, 'no outstanding',
    ],
    [{ ...unpaid, currency: 'USD' }, 'INR'],
  ])('refuses an order that cannot be converted (%#)', async (state, message) => {
    const f = fixture();
    shopify.state.mockResolvedValue(state);
    await expect(
      codOrderCollection(f.db, run({ shopify_order_id: '5551' }))
    ).rejects.toThrow(message);
  });
  it('requires an order from the flow trigger', async () => {
    const f = fixture();
    await expect(codOrderCollection(f.db, run({}))).rejects.toThrow(
      'Shopify order from the flow trigger'
    );
    expect(shopify.state).not.toHaveBeenCalled();
  });
});

describe('marking a paid COD order as paid in Shopify', () => {
  it('marks the order paid, tags it and records success', async () => {
    const f = fixture();
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('synced');
    expect(shopify.markPaid).toHaveBeenCalledWith('demo.myshopify.com', 'token', '5551');
    expect(shopify.tags).toHaveBeenCalledWith('demo.myshopify.com', 'token', '5551', [
      'cod-to-prepaid']);
    expect(f.row).toMatchObject({ shopify_sync_status: 'synced', shopify_sync_error: null ,
    });
  });
  it('does not mark again when the order is already paid', async () => {
    const f = fixture();
    shopify.state.mockResolvedValue({ ...unpaid, outstanding: '0.00', financialStatus: 'PAID' ,
    });
    await syncShopifyOrderPayment(f.db, 'request');
    expect(shopify.markPaid).not.toHaveBeenCalled();
    expect(f.row.shopify_sync_status).toBe('synced');
  });
  it('refuses to mark an order whose balance grew beyond the amount collected', async () => {
    const f = fixture();
    shopify.state.mockResolvedValue({ ...unpaid, outstanding: '1999.00' });
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('failed');
    expect(shopify.markPaid).not.toHaveBeenCalled();
    expect(f.tables.flow_run_events[0]).toMatchObject({
      event_type: 'error',
      payload: { reason: 'shopify_order_sync_failed' },
    });
  });
  it('flags an order cancelled after payment for a manual refund', async () => {
    const f = fixture();
    shopify.state.mockResolvedValue({ ...unpaid, cancelled: true });
    await syncShopifyOrderPayment(f.db, 'request');
    expect(shopify.markPaid).not.toHaveBeenCalled();
    expect(String(f.row.shopify_sync_error)).toContain('Refund');
  });
  it('ignores collections that are not paid', async () => {
    const f = fixture({ status: 'expired' });
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('not_due');
    expect(shopify.state).not.toHaveBeenCalled();
  });
  it('retries with backoff and explains a missing write_orders scope', async () => {
    const f = fixture();
    shopify.markPaid.mockRejectedValue(new Error('Access denied for orderMarkAsPaid field.'));
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('retry');
    expect(f.row.shopify_sync_status).toBe('pending');
    expect(f.row.shopify_sync_attempts).toBe(1);
    expect(String(f.row.shopify_sync_error)).toContain('write_orders');
    expect(Date.parse(String(f.row.shopify_sync_next_at))).toBeGreaterThan(Date.now());
    // Not due again until the backoff elapses.
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('not_due');
  });
  it('gives up after the final attempt', async () => {
    const f = fixture({ shopify_sync_attempts: 7 });
    shopify.state.mockRejectedValue(new Error('Shopify GraphQL error: 502'));
    await expect(syncShopifyOrderPayment(f.db, 'request')).resolves.toBe('failed');
    expect(f.row.shopify_sync_status).toBe('failed');
  });
  it('marks the order once when the webhook and cron overlap', async () => {
    const f = fixture();
    await Promise.all([
      syncShopifyOrderPayment(f.db, 'request'),
      processShopifyOrderSyncs(f.db),
    ]);
    expect(shopify.markPaid).toHaveBeenCalledTimes(1);
  });
});
