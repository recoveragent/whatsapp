import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claimed: null as { account_id: string } | null,
  verify: vi.fn(), register: vi.fn(), subscribe: vi.fn(), sync: vi.fn(),
  isCoexistence: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.claimed, error: null }) }) }) }),
}) }));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (value: string) => `encrypted:${value}` }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: mocks.verify, registerPhoneNumber: mocks.register,
  subscribeWabaToApp: mocks.subscribe, initiateSmbAppDataSync: mocks.sync,
  isCoexistencePhone: mocks.isCoexistence,
}));
import { persistWhatsAppConfig } from './persist-config';

function client(existing: Record<string, unknown> | null) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  return { insert, update, db: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }),
    insert, update,
  }) } };
}
const input = { userId: 'user', accountId: 'brand', phone_number_id: '111', access_token: 'token', coexistence: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.claimed = null;
  mocks.verify.mockResolvedValue({ display_phone_number: '+917010721345' });
  mocks.isCoexistence.mockReturnValue(true);
});
describe('one WhatsApp configuration per account', () => {
  it('refuses a second number before making Meta changes', async () => {
    const { db, insert, update } = client({ id: 'existing', phone_number_id: '222', access_token: 'encrypted' });
    expect(await persistWhatsAppConfig({ ...input, supabase: db as never })).toMatchObject({ ok: false, status: 409 });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it('reconnects by updating the same configuration instead of allocating a tenant', async () => {
    const { db, insert, update } = client({ id: 'existing', phone_number_id: '111', access_token: '' });
    expect(await persistWhatsAppConfig({ ...input, supabase: db as never })).toMatchObject({ ok: true });
    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ reference_name: 'Primary', phone_number_id: '111' }));
    expect(update.mock.results[0].value.eq).toHaveBeenCalledWith('id', 'existing');
  });
  it('allows a replacement only after disconnect while keeping the configuration ID', async () => {
    const { db, insert, update } = client({ id: 'existing', phone_number_id: '222', access_token: '', registered_at: '2026-01-01' });
    expect(await persistWhatsAppConfig({ ...input, supabase: db as never })).toMatchObject({ ok: true });
    expect(insert).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledOnce();
  });
  it('does not claim a phone number owned by another account', async () => {
    mocks.claimed = { account_id: 'other' };
    const { db, insert, update } = client(null);
    expect(await persistWhatsAppConfig({ ...input, supabase: db as never })).toMatchObject({ ok: false, status: 409 });
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
});
describe('coexistence onboarding', () => {
  it('refuses to save when Meta never moves the number to CLOUD_API', async () => {
    vi.useFakeTimers();
    mocks.isCoexistence.mockReturnValue(false);
    mocks.verify.mockResolvedValue({ platform_type: 'ON_PREMISE', is_on_biz_app: true });
    const { db, insert, update } = client({ id: 'existing', phone_number_id: '111', access_token: 'old' });
    const pending = persistWhatsAppConfig({ ...input, supabase: db as never });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok === false && result.error).toContain('ON_PREMISE');
    expect(mocks.verify).toHaveBeenCalledTimes(3);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it('saves once Meta reports the number on CLOUD_API after a recheck', async () => {
    vi.useFakeTimers();
    mocks.isCoexistence.mockReturnValueOnce(false).mockReturnValue(true);
    const { db, update } = client({ id: 'existing', phone_number_id: '111', access_token: 'old' });
    const pending = persistWhatsAppConfig({ ...input, supabase: db as never });
    await vi.runAllTimersAsync();
    const result = await pending;
    vi.useRealTimers();
    expect(result).toMatchObject({ ok: true });
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
  });
});
