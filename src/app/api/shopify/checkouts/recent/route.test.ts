import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: mocks.eq }) }) }),
}));

import { GET } from './route';

describe('recent abandoned checkout samples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue({ accountId: 'brand-1' });
    mocks.eq.mockReturnValue({ order: mocks.order });
    mocks.order.mockReturnValue({ limit: mocks.limit });
  });

  it('returns only the signed-in brand checkouts, shaped like the flow variables, without caching', async () => {
    const raw = { currency: 'INR', total_price: 1199, items: [{ variant_id: 1 }] };
    mocks.limit.mockResolvedValue({
      data: [
        {
          checkout_id: 'wh-1',
          created_at: '2026-10-27T17:51:05Z',
          payload: { _wa_recover_agent_mirror: true, event: { amount: 1199, raw } },
        },
      ],
      error: null,
    });
    const response = await GET();
    expect(mocks.eq).toHaveBeenCalledWith('account_id', 'brand-1');
    expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mocks.limit).toHaveBeenCalledWith(10);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      checkouts: [
        { checkout_id: 'wh-1', created_at: '2026-10-27T17:51:05Z', payload: raw },
      ],
    });
  });

  it('rejects unauthenticated requests before reading checkouts', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new Error('Unauthorized'));
    expect((await GET()).status).toBe(401);
    expect(mocks.eq).not.toHaveBeenCalled();
  });
});
