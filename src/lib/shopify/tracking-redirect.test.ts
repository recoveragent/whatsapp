import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  buildTrackingRedirectUrl,
  enrichContextWithTrackingRedirect,
  ensureShopifyTrackingRedirect,
  getWhatsAppTrackingButtonUrlTemplate,
  isValidTrackingRedirectTarget,
  isValidTrackingRedirectToken,
  resolveShopifyTrackingRedirect,
} from './tracking-redirect';
import type { ShopifyEventContext } from './types';

const baseContext: ShopifyEventContext = {
  customerName: 'Jane',
  phone: '918454048066',
  email: null,
  orderNumber: '#1001',
  orderTotal: '₹999',
  orderItems: 'Widget',
  productImage: null,
  shippingAddress: null,
  shippingAddressFields: null,
  trackingNumber: 'TF4433',
  trackingUrl: 'https://delhivery.com/track/tf4433',
  orderStatusUrl: null,
  orderStatusUrlSuffix: null,
  trackingRedirectSuffix: null,
  checkoutUrl: null,
  fulfillmentStatus: 'success',
  shipmentStatus: 'in_transit',
  financialStatus: 'paid',
  shopName: 'brand',
  resourceKey: 'fulfillment:9',
};

type RedirectRow = Record<string, unknown>;

function mockDb(initial: RedirectRow[] = []) {
  const rows: RedirectRow[] = initial.map((row) => ({ ...row }));

  const findRow = (filters: Record<string, string>) =>
    rows.find((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value),
    );

  return {
    rows,
    from(table: string) {
      if (table !== 'shopify_tracking_redirects') {
        throw new Error(`unexpected table ${table}`);
      }

      const filters: Record<string, string> = {};
      let mode: 'select' | 'update' = 'select';
      let updatePayload: RedirectRow | null = null;

      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return chain;
        },
        insert: (payload: RedirectRow) => ({
          then: (
            resolve: (value: { data: null; error: { code: string } | null }) => void,
          ) => {
            const duplicate = rows.find(
              (row) =>
                row.account_id === payload.account_id &&
                row.shopify_fulfillment_id === payload.shopify_fulfillment_id &&
                payload.shopify_fulfillment_id,
            );
            if (duplicate) {
              resolve({ data: null, error: { code: '23505' } });
              return;
            }
            rows.push({ ...payload });
            resolve({ data: null, error: null });
          },
        }),
        update: (payload: RedirectRow) => {
          mode = 'update';
          updatePayload = payload;
          return chain;
        },
        maybeSingle: async () => {
          if (mode === 'update') {
            const row = findRow(filters);
            if (row && updatePayload) Object.assign(row, updatePayload);
            return { data: row ?? null, error: null };
          }
          return { data: findRow(filters) ?? null, error: null };
        },
        then: (
          resolve: (value: { data: RedirectRow | null; error: null }) => void,
        ) => {
          if (mode === 'update') {
            const row = findRow(filters);
            if (row && updatePayload) Object.assign(row, updatePayload);
            resolve({ data: row ?? null, error: null });
            return;
          }
          resolve({ data: findRow(filters) ?? null, error: null });
        },
      };

      return chain;
    },
  };
}

describe('tracking redirect helpers', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://wa.recoveragent.ai');
  });

  it('validates redirect targets and tokens', () => {
    expect(isValidTrackingRedirectTarget('https://fedex.com/track/1')).toBe(true);
    expect(isValidTrackingRedirectTarget('javascript:alert(1)')).toBe(false);
    expect(isValidTrackingRedirectToken('abc123_-ABC')).toBe(false);
    expect(isValidTrackingRedirectToken('a'.repeat(16))).toBe(true);
  });

  it('builds WhatsApp template URL pattern from site config', () => {
    expect(getWhatsAppTrackingButtonUrlTemplate()).toBe(
      'https://wa.recoveragent.ai/t/{{1}}',
    );
    expect(buildTrackingRedirectUrl('tok1234567890123')).toBe(
      'https://wa.recoveragent.ai/t/tok1234567890123',
    );
  });

  it('creates and reuses a redirect per fulfillment', async () => {
    const db = mockDb();
    const first = await ensureShopifyTrackingRedirect(db as never, {
      accountId: 'acc-1',
      targetUrl: 'https://delhivery.com/track/abc',
      shopifyOrderId: '100',
      shopifyFulfillmentId: '9',
    });
    expect(first).toBeTruthy();
    expect(db.rows).toHaveLength(1);

    const second = await ensureShopifyTrackingRedirect(db as never, {
      accountId: 'acc-1',
      targetUrl: 'https://delhivery.com/track/abc',
      shopifyOrderId: '100',
      shopifyFulfillmentId: '9',
    });
    expect(second).toBe(first);
    expect(db.rows).toHaveLength(1);
  });

  it('updates target URL when carrier link changes', async () => {
    const db = mockDb([
      {
        account_id: 'acc-1',
        token: 'stable-token-123456',
        target_url: 'https://old.example/track/1',
        shopify_fulfillment_id: '9',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);

    const token = await ensureShopifyTrackingRedirect(db as never, {
      accountId: 'acc-1',
      targetUrl: 'https://new.example/track/2',
      shopifyFulfillmentId: '9',
    });

    expect(token).toBe('stable-token-123456');
    expect(db.rows[0]?.target_url).toBe('https://new.example/track/2');
  });

  it('enriches fulfillment context with redirect suffix', async () => {
    const db = mockDb();
    const enriched = await enrichContextWithTrackingRedirect(
      db as never,
      'acc-1',
      baseContext,
      { shopifyFulfillmentId: 9, shopifyOrderId: 100 },
    );
    expect(enriched.trackingRedirectSuffix).toBeTruthy();
    expect(enriched.trackingUrl).toBe('https://delhivery.com/track/tf4433');
  });

  it('resolves active redirects and rejects expired ones', async () => {
    const db = mockDb([
      {
        token: 'live-token-12345678',
        target_url: 'https://carrier.example/x',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
      {
        token: 'dead-token-12345678',
        target_url: 'https://carrier.example/y',
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ]);

    await expect(
      resolveShopifyTrackingRedirect(db as never, 'live-token-12345678'),
    ).resolves.toBe('https://carrier.example/x');
    await expect(
      resolveShopifyTrackingRedirect(db as never, 'dead-token-12345678'),
    ).resolves.toBeNull();
  });
});
