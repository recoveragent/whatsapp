import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchConditionOrderCount } from './admin-api';

afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('Shopify condition history', () => {
  it('reads lifetime counts from the customer, not recent locally cached orders', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ customer: { orders_count: 12 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await fetchConditionOrderCount('test.myshopify.com', 'token', '99')
    ).toBe(12);
    expect(fetchMock.mock.calls[0][0]).toContain('/customers/99.json');
    expect(fetchMock.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe(
      'token'
    );
  });
  it('paginates history and counts orders before the trigger time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ customer: { orders_count: 3 } }))
      .mockImplementationOnce((url: string) =>
        Promise.resolve(
          json(
            {
              orders: [
                { id: '3', created_at: '2026-10-13T00:00:00Z' },
                { id: '2', created_at: '2026-10-12T00:00:00Z' },
              ],
            },
            { link: `<${url}&page_info=next>; rel="next"` }
          )
        )
      )
      .mockResolvedValueOnce(
        json({ orders: [{ id: '1', created_at: '2026-10-11T00:00:00Z' }] })
      );
    vi.stubGlobal('fetch', fetchMock);
    expect(
      await fetchConditionOrderCount(
        'test.myshopify.com',
        'token',
        '99',
        '2026-10-12T23:59:59.999Z'
      )
    ).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('rejects incomplete history rather than misclassifying first-time customers', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ customer: { orders_count: 10 } }))
        .mockResolvedValueOnce(
          json({ orders: [{ id: '3', created_at: '2026-10-13T00:00:00Z' }] })
        )
    );
    await expect(
      fetchConditionOrderCount(
        'test.myshopify.com',
        'token',
        '99',
        '2026-10-12T23:59:59.999Z'
      )
    ).rejects.toThrow('Complete customer history');
  });
  it('rejects pagination links to other hosts before exposing credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ customer: { orders_count: 2 } }))
      .mockResolvedValueOnce(
        json(
          { orders: [] },
          { link: '<https://other.example/orders>; rel="next"' }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      fetchConditionOrderCount(
        'test.myshopify.com',
        'token',
        '99',
        '2026-10-12T23:59:59.999Z'
      )
    ).rejects.toThrow('pagination URL');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
