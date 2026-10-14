import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireAiAgentsAccount: h.auth,
  toErrorResponse: () => Response.json({}, { status: 403 }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { POST, DELETE } from './route';
beforeEach(() => {
  h.from.mockImplementation(() => {
    const chain = {
      update: (patch: unknown) => {
        h.update(patch);
        return chain;
      },
      eq: (...args: unknown[]) => {
        h.eq(...args);
        return chain;
      },
      select: () => chain,
      maybeSingle: async () => ({
        data: { account_id: 'brand-1', user_id: 'member-1' },
        error: null,
      }),
    };
    return chain;
  });
  h.auth.mockResolvedValue({
    supabase: { from: h.from },
    accountId: 'brand-1',
    userId: 'admin-1',
  });
});
const request = (body: unknown) =>
  new Request('http://localhost/api/ai/config', {
    method: 'POST',
    body: JSON.stringify(body),
  });
describe('brand AI configuration boundary', () => {
  it.each(['model', 'provider', 'api_key', 'embeddings_api_key'])(
    'rejects brand changes to %s',
    async (field) => {
      expect((await POST(request({ [field]: 'tampered' }))).status).toBe(403);
      expect(h.update).not.toHaveBeenCalled();
    }
  );
  it('allows partial operational settings without replacing the model', async () => {
    expect(
      (
        await POST(
          request({ system_prompt: 'Helpful', auto_reply_enabled: true })
        )
      ).status
    ).toBe(200);
    expect(h.update).toHaveBeenCalledWith({
      system_prompt: 'Helpful',
      auto_reply_enabled: true,
    });
    expect(h.eq).toHaveBeenCalledWith('account_id', 'brand-1');
  });
  it('cannot delete centrally managed credentials', async () => {
    expect((await DELETE()).status).toBe(403);
    expect(h.from).not.toHaveBeenCalled();
  });
});
