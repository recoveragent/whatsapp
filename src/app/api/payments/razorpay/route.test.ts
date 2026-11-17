import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  upsert: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: () => new Response(null, { status: 500 }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => table === 'flow_payment_requests'
      ? { select: () => ({ eq: () => ({ or: () => ({ in: () => Promise.resolve({ count: 2, error: null }) }) }) }) }
      : { upsert: mocks.upsert },
  }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (value: string) => `encrypted:${value}`, decrypt: vi.fn() }));
vi.mock('@/lib/payments/razorpay', () => ({ razorpayRequest: mocks.verify }));

import { PUT } from './route';

function request(replaceWithPending?: unknown) {
  return new Request('http://localhost/api/payments/razorpay', {
    method: 'PUT',
    body: JSON.stringify({ keyId: 'rzp_live_newkey', keySecret: 'secret', webhookSecret: '1234567890123456', replaceWithPending }),
  });
}

describe('replacing a Razorpay connection with pending collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ accountId: 'account-1' });
    mocks.verify.mockResolvedValue({});
    mocks.upsert.mockResolvedValue({ error: null });
  });

  it('requires explicit confirmation before replacing the connection', async () => {
    for (const confirmation of [undefined, 'true', false]) {
      const response = await PUT(request(confirmation));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'pending_collections' });
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('verifies and saves the new credentials after confirmation', async () => {
    const response = await PUT(request(true));
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ key_id: 'rzp_live_newkey', key_secret_encrypted: 'encrypted:secret' }), { onConflict: 'account_id' });
  });

  it('does not save credentials that fail verification, even after confirmation', async () => {
    mocks.verify.mockRejectedValue(new Error('invalid'));
    expect((await PUT(request(true))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
