import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  eq: vi.fn(),
  store: null as Record<string, unknown> | null,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }));
import { connectedShopifyTrainingSources } from './training-shopify';
const chain = {
  select: () => chain,
  eq: (...args: unknown[]) => {
    h.eq(...args);
    return chain;
  },
  maybeSingle: async () => ({ data: h.store, error: null }),
};
const db = { from: () => chain } as unknown as SupabaseClient;
beforeEach(() => {
  h.store = {
    shop_domain: 'gifts.myshopify.com',
    access_token: 'encrypted',
    status: 'connected',
  };
  vi.stubGlobal('fetch', h.fetch);
  h.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
    const query = JSON.parse(String(options.body)).query as string;
    if (query.includes('Identity'))
      return Response.json({
        data: { shop: { primaryDomain: { url: 'https://gifts.example.com' } } },
      });
    if (query.includes('Policies'))
      return Response.json({
        data: {
          shop: {
            shopPolicies: [
              {
                title: 'Shipping',
                body: '<p>Free prepaid shipping.</p>',
                url: 'https://gifts.example.com/policies/shipping',
              },
            ],
          },
        },
      });
    return Response.json({
      data: {
        products: {
          nodes: [
            {
              title: 'Frame',
              descriptionHtml: '<p>Personalized with your name.</p>',
              onlineStoreUrl: 'https://gifts.example.com/products/frame',
              status: 'ACTIVE',
            },
            {
              title: 'Draft',
              descriptionHtml: 'Secret',
              onlineStoreUrl: null,
              status: 'DRAFT',
            },
          ],
        },
      },
    });
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('connected Shopify training sources', () => {
  it.each(['https://gifts.example.com', 'https://gifts.myshopify.com'])(
    'accepts the connected domain %s and only published sourced content',
    async (url) => {
      const scan = await connectedShopifyTrainingSources(db, 'brand-1', url);
      expect(scan?.sources).toHaveLength(2);
      expect(scan?.sources[0]).toMatchObject({
        text: 'Free prepaid shipping.',
        retrievedVia: 'shopify',
      });
      expect(scan?.warnings.join(' ')).toContain('not a full website scan');
      expect(h.eq).toHaveBeenCalledWith('account_id', 'brand-1');
      for (const [target, options] of h.fetch.mock.calls) {
        expect(target).toBe(
          'https://gifts.myshopify.com/admin/api/2026-10/graphql.json'
        );
        expect(options.redirect).toBe('error');
      }
    }
  );
  it('rejects an unrelated website before reading content', async () => {
    expect(
      await connectedShopifyTrainingSources(
        db,
        'brand-1',
        'https://other.example.com'
      )
    ).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not broaden specific-page scans', async () => {
    expect(
      await connectedShopifyTrainingSources(
        db,
        'brand-1',
        'https://gifts.example.com/faq'
      )
    ).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('requires a connected store', async () => {
    h.store = null;
    expect(
      await connectedShopifyTrainingSources(
        db,
        'brand-1',
        'https://gifts.example.com'
      )
    ).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('validates the API hostname before sending credentials', async () => {
    h.store!.shop_domain = 'attacker.example.com';
    await expect(
      connectedShopifyTrainingSources(
        db,
        'brand-1',
        'https://gifts.example.com'
      )
    ).rejects.toThrow('Invalid connected Shopify domain');
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it('retains policy evidence when product permissions are missing', async () => {
    const original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (url: string, options: RequestInit) => {
      if (String(options.body).includes('TrainingShopProducts')) {
        return Response.json({ errors: [{ message: 'Access denied' }] });
      }
      return original(url, options);
    });
    const scan = await connectedShopifyTrainingSources(
      db,
      'brand-1',
      'https://gifts.example.com'
    );
    expect(scan?.sources).toHaveLength(1);
    expect(scan?.warnings.join(' ')).toContain('read_products');
  });
  it('does not generate training when Shopify has no readable published content', async () => {
    const original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (url: string, options: RequestInit) => {
      if (String(options.body).includes('TrainingShopIdentity'))
        return original(url, options);
      return Response.json({
        data: { shop: { shopPolicies: [] }, products: { nodes: [] } },
      });
    });
    await expect(
      connectedShopifyTrainingSources(
        db,
        'brand-1',
        'https://gifts.example.com'
      )
    ).rejects.toThrow('No published policy or product content');
  });
});
