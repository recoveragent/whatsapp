import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  from: vi.fn(),
  filters: [] as [string, unknown][],
  template: null as Record<string, unknown> | null,
  upsert: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  getCurrentAccount: vi.fn(),
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from: h.from }),
}));

const configId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const body = {
  whatsapp_config_id: configId,
  template_id: templateId,
  company_name: 'Acme',
  enabled: true,
};
const request = (value: unknown) =>
  new Request('https://example.com/api/whatsapp/smart-retry', {
    method: 'PATCH',
    body: JSON.stringify(value),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.filters = [];
  h.requireRole.mockResolvedValue({ accountId: 'active-brand' });
  h.upsert.mockResolvedValue({ error: null });
  h.template = {
    id: templateId,
    user_id: 'owner',
    name: 'receive_message',
    status: 'APPROVED',
    category: 'Marketing',
    body_text: 'A message from {{1}} is waiting.',
    buttons: [{ type: 'QUICK_REPLY', text: 'Receive message' }],
  };
  h.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        h.filters.push([key, value]);
        return query;
      },
      maybeSingle: async () => ({
        data: table === 'whatsapp_config' ? { id: configId } : h.template,
        error: null,
      }),
      upsert: h.upsert,
    };
    return query;
  });
});

describe('Smart Retry settings authorization and validation', () => {
  it('requires admin authorization before reading or writing settings', async () => {
    h.requireRole.mockRejectedValue(new Error('Forbidden'));
    expect((await PATCH(request(body))).status).toBe(403);
    expect(h.requireRole).toHaveBeenCalledWith('admin');
    expect(h.from).not.toHaveBeenCalled();
  });

  it('scopes channel and template checks to the active brand', async () => {
    expect((await PATCH(request(body))).status).toBe(200);
    expect(h.filters.filter(([key]) => key === 'account_id')).toEqual([
      ['account_id', 'active-brand'],
      ['account_id', 'active-brand'],
    ]);
    expect(h.filters).toContainEqual(['whatsapp_config_id', configId]);
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'active-brand',
        whatsapp_config_id: configId,
        enabled: true,
      }),
      { onConflict: 'whatsapp_config_id' }
    );
  });

  it('refuses enabling with a template not found for this number', async () => {
    h.template = null;
    expect((await PATCH(request(body))).status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('rejects non-boolean enabled flags and malformed identifiers', async () => {
    expect((await PATCH(request({ ...body, enabled: 'false' }))).status).toBe(
      400
    );
    expect(
      (await PATCH(request({ ...body, whatsapp_config_id: 'wrong' }))).status
    ).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });
});
