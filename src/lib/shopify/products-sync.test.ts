import { describe, expect, it, vi, beforeEach } from 'vitest';

import * as adminApi from './admin-api';
import { pickDefaultVariant, syncShopifyProductsForAccount } from './products-sync';
import type { ShopifyProductPayload } from './types';

vi.mock('./admin-api', async (importOriginal) => {
  const actual = await importOriginal<typeof adminApi>();
  return {
    ...actual,
    fetchProductsPage: vi.fn(),
  };
});

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}));

function product(overrides: Partial<ShopifyProductPayload> = {}): ShopifyProductPayload {
  return {
    id: 100,
    title: 'Blue Widget',
    handle: 'blue-widget',
    status: 'active',
    image: { src: 'https://cdn.shopify.com/widget.jpg' },
    variants: [
      {
        id: 1001,
        title: 'Default',
        price: '499.00',
        inventory_quantity: 5,
        inventory_management: 'shopify',
        available: true,
      },
    ],
    ...overrides,
  };
}

function mockDb() {
  const syncRuns: Record<string, unknown>[] = [];
  const products: Record<string, unknown>[] = [];
  let syncRunCounter = 0;

  const db = {
    from(table: string) {
      if (table === 'shopify_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  shop_domain: 'demo.myshopify.com',
                  access_token: 'encrypted',
                  status: 'connected',
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }

      if (table === 'shopify_product_sync_runs') {
        return {
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                syncRunCounter += 1;
                const row = { id: `run-${syncRunCounter}`, ...payload };
                syncRuns.push(row);
                return { data: row, error: null };
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async () => {
              const row = syncRuns[syncRuns.length - 1];
              Object.assign(row, payload);
              return { error: null };
            },
          }),
        };
      }

      if (table === 'shopify_products') {
        return {
          upsert: async (rows: Record<string, unknown>[]) => {
            for (const row of rows) {
              const existing = products.find(
                (item) =>
                  item.account_id === row.account_id &&
                  item.shopify_variant_id === row.shopify_variant_id,
              );
              if (existing) Object.assign(existing, row);
              else products.push({ ...row });
            }
            return { error: null };
          },
          select: () => ({
            eq: (_column: string, value: unknown) => ({
              eq: () => ({
                async then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) {
                  resolve({
                    data: products.filter(
                      (item) => item.account_id === value && item.status === 'active',
                    ),
                    error: null,
                  });
                },
              }),
            }),
          }),
          update: () => ({
            in: async () => ({ error: null }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
    products,
    syncRuns,
  };

  return db;
}

describe('pickDefaultVariant', () => {
  it('prefers an in-stock variant over an out-of-stock one', () => {
    const chosen = pickDefaultVariant([
      {
        id: 1,
        title: 'Sold out',
        inventory_management: 'shopify',
        inventory_quantity: 0,
        available: true,
      },
      {
        id: 2,
        title: 'Available',
        inventory_management: 'shopify',
        inventory_quantity: 3,
        available: true,
      },
    ]);

    expect(chosen?.id).toBe(2);
  });
});

describe('syncShopifyProductsForAccount', () => {
  beforeEach(() => {
    vi.mocked(adminApi.fetchProductsPage).mockReset();
  });

  it('upserts every variant for each active product', async () => {
    vi.mocked(adminApi.fetchProductsPage)
      .mockResolvedValueOnce({
        products: [
          product({
            variants: [
              {
                id: 1001,
                title: 'Design 1',
                price: '799.00',
                inventory_quantity: 5,
                inventory_management: 'shopify',
                available: true,
              },
              {
                id: 1002,
                title: 'Design 2',
                price: '849.00',
                inventory_quantity: 2,
                inventory_management: 'shopify',
                available: true,
              },
            ],
          }),
        ],
        nextPageInfo: null,
        shopCurrency: 'INR',
      });

    const db = mockDb();
    const result = await syncShopifyProductsForAccount(db as never, 'acct-1');

    expect(result.status).toBe('success');
    expect(result.upserted).toBe(2);
    expect(db.products).toHaveLength(2);
    expect(db.products.map((row) => row.shopify_variant_id)).toEqual([1001, 1002]);
  });

  it('upserts active products from Shopify', async () => {
    vi.mocked(adminApi.fetchProductsPage)
      .mockResolvedValueOnce({
        products: [product()],
        nextPageInfo: null,
        shopCurrency: 'INR',
      });

    const db = mockDb();
    const result = await syncShopifyProductsForAccount(db as never, 'acct-1');

    expect(result.status).toBe('success');
    expect(result.upserted).toBe(1);
    expect(db.products).toHaveLength(1);
    expect(db.products[0]).toMatchObject({
      account_id: 'acct-1',
      shopify_product_id: 100,
      shopify_variant_id: 1001,
      title: 'Blue Widget',
      currency: 'INR',
    });
  });

  it('returns failed when Shopify is not connected', async () => {
    const db = {
      from(table: string) {
        if (table !== 'shopify_config') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      },
    };

    const result = await syncShopifyProductsForAccount(db as never, 'acct-1');
    expect(result.status).toBe('failed');
    expect(result.error_message).toMatch(/not connected/i);
  });
});
