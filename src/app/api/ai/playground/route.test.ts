import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  generate: vi.fn(),
  eq: vi.fn(),
  carouselEnabled: false,
}));
vi.mock('@/lib/auth/account', () => ({
  requireAiAgentsAccount: h.auth,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/ai/config', () => ({
  loadAiConfig: async () => ({
    provider: 'openai',
    apiKey: 'test',
    model: 'test',
    systemPrompt: null,
  }),
}));
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generate }));
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: async () => [] }));
vi.mock('@/lib/ai/shopify-context', () => ({
  retrieveShopifyContext: async () => null,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { aiDraft: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { POST } from './route';

beforeEach(() => {
  h.carouselEnabled = true;
  h.generate.mockResolvedValue({ text: 'Here is a match.', handoff: false });
  const products = [
    {
      id: '1',
      shopify_product_id: 1,
      shopify_variant_id: 101,
      title: 'Hoodie',
      variant_title: 'Large',
      price: '900.00',
      currency: 'INR',
      image_url: 'https://cdn.test/1.jpg',
      inventory_quantity: 4,
    },
    {
      id: '2',
      shopify_product_id: 2,
      shopify_variant_id: 102,
      title: 'Hoodie',
      variant_title: 'Large',
      price: '1800.00',
      currency: 'INR',
      image_url: 'https://cdn.test/2.jpg',
      inventory_quantity: 4,
    },
    {
      id: '3',
      shopify_product_id: 3,
      shopify_variant_id: 103,
      title: 'Hoodie',
      variant_title: 'XL',
      price: '800.00',
      currency: 'INR',
      image_url: 'https://cdn.test/3.jpg',
      inventory_quantity: 4,
    },
  ];
  const db = {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          h.eq(...args);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        or: () => chain,
        maybeSingle: async () => ({
          data: {
            shop_domain: 'gifts.myshopify.com',
            status: 'connected',
            sell_on_whatsapp_enabled: h.carouselEnabled,
          },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'shopify_products' ? products : null,
            error: null,
          }).then(resolve),
      };
      return chain;
    },
  };
  h.auth.mockResolvedValue({
    supabase: db,
    accountId: 'acct-1',
    userId: 'user-1',
  });
});
const request = (content: string) =>
  new Request('http://localhost/api/ai/playground', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  });

describe('playground guided selling', () => {
  it('shows only the price- and size-compatible product, even with no carousel', async () => {
    const response = await POST(request('Show hoodies under INR 1000 size L'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.product_carousel).toBeNull();
    expect(body.reply).toContain('INR 900.00');
    expect(body.reply).toContain('/cart/101:1');
    expect(body.reply).not.toContain('/cart/102:1');
    expect(body.reply).not.toContain('/cart/103:1');
    expect(h.eq).toHaveBeenCalledWith('account_id', 'acct-1');
    expect(h.generate.mock.calls[0][0].systemPrompt).toContain(
      'append the matched product names'
    );
  });
  it('does not promise a carousel for a single result even when enabled', async () => {
    h.carouselEnabled = true;
    const body = await (
      await POST(request('Show hoodies under INR 1000 size L'))
    ).json();
    expect(body.product_carousel).toBeNull();
    expect(body.reply).toContain('/cart/101:1');
  });
  it('asks for clarification when currency is ambiguous instead of showing arbitrary prices', async () => {
    const body = await (await POST(request('Show hoodies under $50'))).json();
    expect(body.reply).not.toContain('/cart/');
    expect(h.generate.mock.calls[0][0].systemPrompt).toContain(
      '"ambiguousCurrency":true'
    );
  });
  it('does not attach product links on handoff', async () => {
    h.generate.mockResolvedValueOnce({ text: '', handoff: true });
    const body = await (
      await POST(request('Show hoodies under INR 1000 size L'))
    ).json();
    expect(body.reply).toBe('');
    expect(body.product_carousel).toBeNull();
  });
  it('respects the merchant product-send switch in the preview', async () => {
    h.carouselEnabled = false;
    const body = await (
      await POST(request('Show hoodies under INR 1000 size L'))
    ).json();
    expect(body.reply).toContain('INR 900.00');
    expect(body.reply).not.toContain('/cart/');
    expect(body.product_carousel).toBeNull();
  });
});
