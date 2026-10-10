import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: null as Record<string, unknown> | null, update: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/auth/account', () => {
  const context = () => ({ accountId: 'brand', supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.config, error: null }) }) }),
    update: state.update,
  }) } });
  return { getCurrentAccount: context, requireRole: context, toErrorResponse: () => { throw new Error('Unexpected route error'); } };
});
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token' }));
vi.mock('@/lib/whatsapp/meta-api', () => ({ verifyPhoneNumber: state.verify }));
import { GET, DELETE } from './route';
beforeEach(() => {
  vi.clearAllMocks(); state.config = null;
  state.update.mockReturnValue({ eq: () => ({ eq: async () => ({ error: null }) }) });
});
describe('single WhatsApp connection', () => {
  it('offers connection again after credentials are cleared', async () => {
    state.config = { id: 'same-id', access_token: '', status: 'disconnected' };
    expect(await (await GET()).json()).toMatchObject({ configured: false, connected: false });
    expect(state.verify).not.toHaveBeenCalled();
  });
  it('returns the single configuration without a sender list or credentials', async () => {
    state.config = { id: 'same-id', access_token: 'encrypted', phone_number_id: '111', status: 'connected' };
    state.verify.mockResolvedValue({ display_phone_number: '+917010721345' });
    const data = await (await GET()).json();
    expect(data).toMatchObject({ id: 'same-id', configured: true, connected: true });
    expect(data).not.toHaveProperty('numbers'); expect(data).not.toHaveProperty('access_token');
  });
  it('disconnects by clearing credentials while retaining the referenced row', async () => {
    expect(await (await DELETE(new Request('https://example.test/api/whatsapp/connection?id=same-id'))).json()).toEqual({ success: true });
    expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ access_token: '', verify_token: null, status: 'disconnected' }));
  });
});
