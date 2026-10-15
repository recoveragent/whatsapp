import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(),
  fetchRecentOrderPayloads: vi.fn(), decrypt: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: mocks.eq }) }) }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('@/lib/shopify/admin-api', () => ({ fetchRecentOrderPayloads: mocks.fetchRecentOrderPayloads }));

import { GET } from './route';

describe('recent Shopify order samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue({ accountId: 'brand-1' });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.decrypt.mockReturnValue('decrypted');
  });

  it('uses only the signed-in account connection and prevents caching customer payloads', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { shop_domain: 'brand.myshopify.com', access_token: 'encrypted', status: 'connected' } });
    const orders = [{ id: 1, customer: { first_name: 'Ada' } }];
    mocks.fetchRecentOrderPayloads.mockResolvedValue(orders);
    const response = await GET();
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'brand-1');
    expect(mocks.fetchRecentOrderPayloads).toHaveBeenCalledWith('brand.myshopify.com', 'decrypted');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ orders });
  });

  it('does not fetch orders for disconnected brands or unauthenticated requests', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null });
    expect((await GET()).status).toBe(409);
    mocks.getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));
    expect((await GET()).status).toBe(401);
    expect(mocks.fetchRecentOrderPayloads).not.toHaveBeenCalled();
  });
});
