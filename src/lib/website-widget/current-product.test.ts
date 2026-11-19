import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({ queryShop: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/ai/training-shopify', () => ({ queryShop: mocks.queryShop }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
import { loadCurrentProduct, parseProductHandle } from './current-product';

function database(store: unknown) {
  const eq = vi.fn().mockReturnValue({ maybeSingle: async () => ({ data: store, error: null }) });
  return { db: { from: () => ({ select: () => ({ eq }) }) } as unknown as SupabaseClient, eq };
}

beforeEach(() => { vi.clearAllMocks(); mocks.decrypt.mockReturnValue('token'); });

describe('current product context', () => {
  it.each(['https://evil.com/products/x', '../other', 'x?token=secret', '', 'x/y'])('rejects invalid handles: %s', (handle) => {
    expect(parseProductHandle(handle)).toBeNull();
  });
  it('looks up the handle only in the widget account connected shop', async () => {
    const { db, eq } = database({ status: 'connected', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' });
    mocks.queryShop.mockResolvedValue({ productByIdentifier: { title: 'Frame', description: 'Made of oak', status: 'ACTIVE', onlineStoreUrl: 'https://store.test/products/frame' } });
    expect(await loadCurrentProduct(db, 'account-a', 'frame')).toEqual({ title: 'Frame', description: 'Made of oak', currency: null, variants: [], variantsTruncated: false, selectedVariantId: null });
    expect(eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(mocks.queryShop).toHaveBeenCalledWith('merchant.myshopify.com', 'token', expect.any(String), expect.any(AbortSignal), { identifier: { handle: 'frame' } });
  });
  it('returns Shopify variant availability and verifies the selected variant belongs to this product', async () => {
    const { db } = database({ status: 'connected', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' });
    mocks.queryShop.mockResolvedValue({ shop: { currencyCode: 'INR' }, productByIdentifier: {
      title: 'Wallet', description: 'Vegan leather', status: 'ACTIVE', onlineStoreUrl: 'https://store.test/products/wallet',
      variants: { nodes: [
        { id: 'gid://shopify/ProductVariant/101', title: 'Blue', price: '690.00', availableForSale: true, selectedOptions: [{ name: 'Color', value: 'Blue' }] },
        { id: 'gid://shopify/ProductVariant/102', title: 'Brown', price: '690.00', availableForSale: false, selectedOptions: [{ name: 'Color', value: 'Brown' }] },
      ], pageInfo: { hasNextPage: true } },
    } });
    const result = await loadCurrentProduct(db, 'account-a', 'wallet', '102');
    expect(result).toMatchObject({ currency: 'INR', selectedVariantId: '102', variantsTruncated: true, variants: [
      { id: '101', availableForSale: true, options: [{ name: 'Color', value: 'Blue' }] },
      { id: '102', availableForSale: false, options: [{ name: 'Color', value: 'Brown' }] },
    ] });
    expect((await loadCurrentProduct(db, 'account-a', 'wallet', '999'))?.selectedVariantId).toBeNull();
  });

  it.each([
    { status: 'DRAFT', onlineStoreUrl: 'https://store.test/products/frame' },
    { status: 'ACTIVE', onlineStoreUrl: null },
  ])('does not expose unpublished products', async (product) => {
    const { db } = database({ status: 'connected', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' });
    mocks.queryShop.mockResolvedValue({ productByIdentifier: { title: 'Secret', description: 'private', ...product } });
    expect(await loadCurrentProduct(db, 'account-a', 'secret')).toBeNull();
  });
  it('fails closed when Shopify is unavailable', async () => {
    const { db } = database({ status: 'connected', shop_domain: 'merchant.myshopify.com', access_token: 'encrypted' });
    mocks.queryShop.mockRejectedValue(new Error('unavailable'));
    expect(await loadCurrentProduct(db, 'account-a', 'frame')).toBeNull();
  });
});
