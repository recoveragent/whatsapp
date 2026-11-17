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
    expect(await loadCurrentProduct(db, 'account-a', 'frame')).toEqual({ title: 'Frame', description: 'Made of oak' });
    expect(eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(mocks.queryShop).toHaveBeenCalledWith('merchant.myshopify.com', 'token', expect.any(String), expect.any(AbortSignal), { identifier: { handle: 'frame' } });
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
