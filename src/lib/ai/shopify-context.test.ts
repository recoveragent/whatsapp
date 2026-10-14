import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildSystemPrompt } from './defaults';
import {
  aiShopifyOrderLimit,
  formatShopifyOrderForAi,
  formatShopifyOrdersForAi,
  retrieveShopifyContext,
} from './shopify-context';
import type { ShopifyOrder } from '@/types';

vi.mock('./live-orders', () => ({ loadLiveAiOrders: vi.fn() }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plain-token'),
}));
import { loadLiveAiOrders } from './live-orders';

vi.mock('@/lib/inbox/tables', () => ({
  hasShopifyOrdersTable: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/shopify/contact-orders', () => ({
  loadCachedOrdersForContact: vi.fn(),
}));

import { hasShopifyOrdersTable } from '@/lib/inbox/tables';
import { loadCachedOrdersForContact } from '@/lib/shopify/contact-orders';

const SAMPLE_ORDER: ShopifyOrder = {
  id: 'ord-1',
  account_id: 'acct-1',
  contact_id: 'contact-1',
  customer_phone: '+919876543210',
  shopify_order_id: '5678901234',
  order_number: '#1042',
  total_price: '1998.00',
  currency: 'INR',
  payment_status: 'paid',
  payment_gateway: 'cod',
  order_status: 'open',
  product_title: 'Blue T-Shirt ×2',
  shipping_address: '12 MG Road\nBangalore\n560001',
  fulfillment_status: 'fulfilled',
  shipment_status: 'in_transit',
  tracking_url: 'https://track.example/abc',
  tracking_number: 'DHL123456',
  order_status_url: null,
  admin_url: null,
  tags: [],
  ordered_at: '2026-01-05T10:00:00.000Z',
  created_at: '2026-01-05T10:00:00.000Z',
  updated_at: '2026-01-05T10:00:00.000Z',
};

describe('formatShopifyOrderForAi', () => {
  it('includes order details the model needs for support replies', () => {
    const text = formatShopifyOrderForAi(SAMPLE_ORDER);
    expect(text).toContain('Order #1042');
    expect(text).toContain('Blue T-Shirt ×2');
    expect(text).toContain('1998.00 INR');
    expect(text).toContain('paid');
    expect(text).toContain('in transit');
    expect(text).toContain('DHL123456');
    expect(text).toContain('Bangalore');
  });
});

describe('formatShopifyOrdersForAi', () => {
  it('limits to aiShopifyOrderLimit orders', () => {
    const limit = aiShopifyOrderLimit();
    const orders = Array.from({ length: limit + 3 }, (_, i) => ({
      ...SAMPLE_ORDER,
      id: `ord-${i}`,
      order_number: `#${1000 + i}`,
    }));
    const text = formatShopifyOrdersForAi(orders);
    expect(text.match(/Order #/g)?.length).toBe(limit);
  });
});

describe('buildSystemPrompt with shopifyContext', () => {
  it('injects Shopify order data into the system prompt', () => {
    const shopifyContext = formatShopifyOrdersForAi([SAMPLE_ORDER]);
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      shopifyContext,
    });
    expect(prompt).toContain('Shopify order data for this customer');
    expect(prompt).toContain('Order #1042');
    expect(prompt).toContain('[[HANDOFF]]');
  });
});

describe('retrieveShopifyContext', () => {
  beforeEach(() => {
    vi.mocked(hasShopifyOrdersTable).mockResolvedValue(true);
    vi.mocked(loadCachedOrdersForContact).mockReset();
    vi.mocked(loadLiveAiOrders).mockReset();
  });

  it('returns null when Shopify is not connected', async () => {
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === 'shopify_config'
                    ? { status: 'disconnected' }
                    : null,
                error: null,
              }),
          }),
        }),
      }),
    };

    const result = await retrieveShopifyContext(
      db as never,
      'acct-1',
      'contact-1'
    );
    expect(result).toBeNull();
    expect(loadCachedOrdersForContact).not.toHaveBeenCalled();
  });

  it('returns formatted orders when Shopify is connected', async () => {
    vi.mocked(loadCachedOrdersForContact).mockResolvedValue([SAMPLE_ORDER]);

    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'shopify_config'
                  ? { status: 'connected' }
                  : table === 'contacts'
                    ? { phone: '+919876543210' }
                    : null,
              error: null,
            }),
        };
        return chain;
      },
    };

    const result = await retrieveShopifyContext(
      db as never,
      'acct-1',
      'contact-1'
    );
    expect(result).toContain('Order #1042');
    expect(loadCachedOrdersForContact).toHaveBeenCalledWith(
      db,
      'acct-1',
      'contact-1',
      '+919876543210',
      { linkContact: false }
    );
  });

  it('swallows errors and returns null', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.reject(new Error('db down')),
          }),
        }),
      }),
    };

    const result = await retrieveShopifyContext(
      db as never,
      'acct-1',
      'contact-1'
    );
    expect(result).toBeNull();
  });

  function connectedDb(
    contact: { phone: string } | null = { phone: '+919876543210' }
  ) {
    const eq = vi.fn();
    const db = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => {
            eq(...args);
            return chain;
          },
          maybeSingle: async () => ({
            data:
              table === 'shopify_config'
                ? {
                    status: 'connected',
                    shop_domain: 'store.myshopify.com',
                    access_token: 'encrypted',
                  }
                : contact,
            error: null,
          }),
        };
        return chain;
      },
    };
    return { db, eq };
  }

  it('uses live verified data without needing the cache', async () => {
    const { db, eq } = connectedDb();
    vi.mocked(loadLiveAiOrders).mockResolvedValue([SAMPLE_ORDER]);
    const result = await retrieveShopifyContext(
      db as never,
      'acct-1',
      'contact-1',
      { refresh: true }
    );
    expect(result).toContain('Source: Shopify live lookup (phone verified)');
    expect(loadCachedOrdersForContact).not.toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('account_id', 'acct-1');
    expect(loadLiveAiOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+919876543210',
        contactId: 'contact-1',
        accountId: 'acct-1',
      })
    );
  });

  it('labels cached data honestly if the live request fails', async () => {
    const { db } = connectedDb();
    vi.mocked(loadLiveAiOrders).mockRejectedValue(new Error('timeout'));
    vi.mocked(loadCachedOrdersForContact).mockResolvedValue([SAMPLE_ORDER]);
    const result = await retrieveShopifyContext(
      db as never,
      'acct-1',
      'contact-1',
      { refresh: true }
    );
    expect(result).toContain('This is cached data');
    expect(result).toContain('Order #1042');
  });

  it('never queries Shopify for a missing or foreign account contact', async () => {
    const { db } = connectedDb(null);
    expect(
      await retrieveShopifyContext(db as never, 'acct-1', 'foreign-contact', {
        refresh: true,
      })
    ).toBeNull();
    expect(loadLiveAiOrders).not.toHaveBeenCalled();
    expect(loadCachedOrdersForContact).not.toHaveBeenCalled();
  });

  it('does not disclose cached orders matched only by an eight-digit suffix', async () => {
    const { db } = connectedDb();
    vi.mocked(loadCachedOrdersForContact).mockResolvedValue([
      { ...SAMPLE_ORDER, customer_phone: '+449876543210' },
    ]);
    expect(await retrieveShopifyContext(db as never, 'acct-1', 'contact-1')).toBeNull();
  });
});
