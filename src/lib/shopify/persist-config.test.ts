import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetchShopInfo: vi.fn(), renew: vi.fn(), register: vi.fn() }));
vi.mock('./admin-api', async (original) => ({
  ...(await original<typeof import('./admin-api')>()),
  fetchShopInfo: mocks.fetchShopInfo,
  registerShopifyWebhooks: mocks.register,
}));
vi.mock('./token-renewal', () => ({ requestShopifyClientToken: mocks.renew }));
vi.mock('@/lib/ecommerce/assert-platform', () => ({ ensureAccountEcommercePlatform: async () => ({ ok: true }) }));
vi.mock('./send-campaign', () => ({ seedDefaultCampaigns: vi.fn() }));
import { ShopifyApiError } from './admin-api';
import { persistShopifyConfig } from './persist-config';
import { decrypt } from '@/lib/whatsapp/encryption';

afterEach(() => vi.resetAllMocks());

describe('Shopify import token renewal', () => {
  it('renews a rejected handoff token, verifies it, and persists the renewed token', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }), upsert };
    mocks.fetchShopInfo.mockRejectedValueOnce(new ShopifyApiError('Expired token', 401))
      .mockResolvedValueOnce({ name: 'Brand', domain: 'brand.myshopify.com' });
    mocks.renew.mockResolvedValue('renewed');
    const result = await persistShopifyConfig({
      supabase: { from: () => builder } as never,
      userId: 'user', accountId: 'brand', shopDomain: 'brand.myshopify.com',
      accessToken: 'expired', apiKey: 'client', apiSecret: 'secret',
      webhookCallbackUrl: 'https://wa.recoveragent.ai/api/shopify/webhook',
    });
    expect(result.ok).toBe(true);
    expect(mocks.renew).toHaveBeenCalledWith('brand.myshopify.com', 'client', 'secret');
    expect(mocks.fetchShopInfo).toHaveBeenLastCalledWith('brand.myshopify.com', 'renewed', false);
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'renewed' }));
    expect(decrypt(upsert.mock.calls[0][0].access_token)).toBe('renewed');
  });

  it('does not renew tokens for permission failures or save an unverified connection', async () => {
    const upsert = vi.fn();
    const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null }), upsert };
    mocks.fetchShopInfo.mockRejectedValue(new ShopifyApiError('Missing scope', 403));
    const result = await persistShopifyConfig({ supabase: { from: () => builder } as never, userId: 'user', accountId: 'brand', shopDomain: 'brand.myshopify.com', accessToken: 'token', apiKey: 'client', apiSecret: 'secret', webhookCallbackUrl: 'https://wa.recoveragent.ai/api/shopify/webhook' });
    expect(result.ok).toBe(false);
    expect(mocks.renew).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
