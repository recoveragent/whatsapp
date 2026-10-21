import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, db, currentAccount, requireRole } = vi.hoisted(() => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const db = { from: vi.fn(() => query) };
  return { query, db, currentAccount: vi.fn(), requireRole: vi.fn() };
});
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: currentAccount,
  requireRole,
  toErrorResponse: (err: { status?: number }) =>
    Response.json({ error: 'Denied' }, { status: err.status ?? 500 }),
}));
import { GET, PATCH } from './route';
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/whatsapp/direct-send', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
beforeEach(() => {
  vi.clearAllMocks();
  currentAccount.mockResolvedValue({ supabase: db, accountId: 'account-one' });
  requireRole.mockResolvedValue({ supabase: db, accountId: 'account-one' });
  query.maybeSingle.mockResolvedValue({
    data: { id: 'config-one', direct_send_status: 'unknown' },
    error: null,
  });
});
describe('Direct Send availability API', () => {
  it('reads only the current account and requested connection', async () => {
    const res = await GET(
      new Request(
        'http://localhost/api/whatsapp/direct-send?config_id=config-one'
      )
    );
    expect(await res.json()).toEqual({
      config_id: 'config-one',
      status: 'unknown',
    });
    expect(query.eq.mock.calls).toEqual([
      ['account_id', 'account-one'],
      ['id', 'config-one'],
    ]);
  });
  it('requires explicit Meta confirmation before enabling', async () => {
    const res = await patch({ config_id: 'config-one', status: 'enabled' });
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(res.status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
  it('scopes confirmed access updates to the current connected account', async () => {
    const res = await patch({
      config_id: 'config-one',
      status: 'enabled',
      meta_access_confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({
      direct_send_status: 'enabled',
    });
    expect(query.eq.mock.calls).toEqual([
      ['account_id', 'account-one'],
      ['id', 'config-one'],
      ['status', 'connected'],
    ]);
  });
  it('refuses an ordinary agent before touching the database', async () => {
    requireRole.mockRejectedValueOnce({ status: 403 });
    expect(
      (
        await patch({
          config_id: 'config-one',
          status: 'enabled',
          meta_access_confirmed: true,
        })
      ).status
    ).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });
  it('does not report success for missing or foreign configurations', async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (await patch({ config_id: 'other-config', status: 'unavailable' })).status
    ).toBe(404);
  });
  it('rejects unknown status values', async () => {
    expect(
      (await patch({ config_id: 'config-one', status: 'yes' })).status
    ).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});
