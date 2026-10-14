import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLiveAiOrders } from './live-orders';

const args = {
  shopDomain: 'example.myshopify.com',
  accessToken: 'secret',
  phone: '919876543210',
  accountId: 'account-1',
  contactId: 'contact-1',
};
afterEach(() => vi.unstubAllGlobals());

describe('live order lookup', () => {
  it('verifies ownership, deduplicates, sorts and strips private fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    fetchMock.mockImplementation(async () =>
      Response.json({
        orders: [
          {
            id: 1,
            name: '#1',
            phone: '+919876543210',
            financial_status: 'paid',
            created_at: '2026-01-01',
            shipping_address: { address1: 'Private street' },
          },
          {
            id: 2,
            name: '#2',
            phone: '+919876543210',
            created_at: '2026-02-01',
            fulfillment_status: null,
          },
          { id: 3, phone: '+919999999999', name: 'Someone else' },
          { id: 4, name: 'Redacted identity' },
          {
            id: 5,
            phone: '+449876543210',
            name: 'Same suffix, different country',
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const orders = await loadLiveAiOrders(args);
    expect(orders.map((order) => order.order_number)).toEqual(['#2', '#1']);
    expect(orders[0].fulfillment_status).toBe('unfulfilled');
    expect(orders[1].shipping_address).toBeNull();
    expect(orders[1].account_id).toBe('account-1');
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('secret');
  });

  it('fails on upstream errors so the caller can use its cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 })
    );
    await expect(loadLiveAiOrders(args)).rejects.toThrow('unavailable');
  });

  it('rejects untrusted hosts before forwarding credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const host of [
      'localhost',
      'evil.test',
      'foo@bar.myshopify.com',
      'foo.myshopify.com:443',
      'foo..myshopify.com',
    ]) {
      await expect(
        loadLiveAiOrders({ ...args, shopDomain: host })
      ).rejects.toThrow('Invalid Shopify host');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
