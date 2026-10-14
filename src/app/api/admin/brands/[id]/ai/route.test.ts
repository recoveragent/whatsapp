import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  admin: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  eq: vi.fn(),
  validate: vi.fn(),
  existing: {
    provider: 'openai',
    model: 'old-model',
    api_key: 'encrypted',
  } as Record<string, unknown> | null,
}));
vi.mock('@/lib/auth/super-admin', () => ({ requireSuperAdminBrand: h.guard }));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: () => Response.json({}, { status: 403 }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/ai/validate', () => ({ validateAiCredentials: h.validate }));
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn() }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plaintext',
  encrypt: (value: string) => 'encrypted:' + value,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { GET, POST } from './route';
const ctx = { params: Promise.resolve({ id: 'brand-1' }) };
const request = (body: unknown) =>
  new Request('http://localhost/api/admin/brands/brand-1/ai', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  h.existing = { provider: 'openai', model: 'old-model', api_key: 'encrypted' };
  h.guard.mockResolvedValue({ brand: { id: 'brand-1' }, userId: 'super-1' });
  h.validate.mockResolvedValue(undefined);
  h.admin.mockImplementation(() => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          h.eq(...args);
          return chain;
        },
        maybeSingle: async () => ({ data: h.existing, error: null }),
        update: (patch: unknown) => {
          h.update(patch);
          return chain;
        },
        insert: (patch: unknown) => {
          h.insert(patch);
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
  }));
});
describe('super-admin AI model endpoint', () => {
  it('rejects a brand admin or foreign organization before using the service role', async () => {
    h.guard.mockRejectedValue(new Error('Forbidden'));
    expect(
      (await POST(request({ provider: 'openai', model: 'new-model' }), ctx))
        .status
    ).toBe(403);
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('updates only credentials, preserving brand behavior', async () => {
    expect(
      (
        await POST(
          request({
            provider: 'openai',
            model: 'new-model',
            is_active: false,
            system_prompt: 'Ignore',
          }),
          ctx
        )
      ).status
    ).toBe(200);
    expect(h.update).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'new-model',
    });
    expect(h.eq).toHaveBeenCalledWith('account_id', 'brand-1');
    expect(h.validate).toHaveBeenCalled();
  });
  it('never returns ciphertext or plaintext API keys', async () => {
    const body = await (await GET(new Request('http://localhost'), ctx)).json();
    expect(body).toMatchObject({ model: 'old-model', has_key: true });
    expect(JSON.stringify(body)).not.toContain('encrypted');
    expect(JSON.stringify(body)).not.toContain('plaintext');
  });
  it('requires a fresh key when changing providers', async () => {
    expect(
      (
        await POST(
          request({ provider: 'anthropic', model: 'claude-test' }),
          ctx
        )
      ).status
    ).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('supports credential testing without saving', async () => {
    expect(
      (
        await POST(
          request({ provider: 'openai', model: 'new-model', test_only: true }),
          ctx
        )
      ).status
    ).toBe(200);
    expect(h.validate).toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
  });
  it('creates new configs with automatic replies disabled', async () => {
    h.existing = null;
    expect(
      (
        await POST(
          request({
            provider: 'openai',
            model: 'new-model',
            api_key: 'new-key',
          }),
          ctx
        )
      ).status
    ).toBe(200);
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'brand-1',
        api_key: 'encrypted:new-key',
        is_active: false,
        auto_reply_enabled: false,
      })
    );
  });
});
