import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  fetchPolicies: vi.fn(),
  ingest: vi.fn(),
  store: {
    shop_domain: 'store.myshopify.com',
    status: 'connected',
    access_token: 'encrypted',
    sell_on_whatsapp_enabled: true,
  },
}));
vi.mock('@/lib/auth/account', () => ({
  requireAiAgentsAccount: h.auth,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'decrypted-token',
}));
vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: async () => ({ key: null, corrupt: false }),
}));
vi.mock('@/lib/ai/knowledge', () => ({ ingestDocument: h.ingest }));
vi.mock('@/lib/ai/storefront', async (original) => ({
  ...(await original<typeof import('@/lib/ai/storefront')>()),
  fetchStorefrontPolicies: h.fetchPolicies,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { GET, POST } from './route';

beforeEach(() => {
  h.from.mockImplementation((table: string) => {
    const response = {
      data:
        table === 'shopify_config'
          ? h.store
          : { id: 'doc-1', updated_at: '2026-10-12' },
      error: null,
      count: 4,
    };
    const chain = {
      select: (...args: unknown[]) => {
        h.select(...args);
        return chain;
      },
      eq: (...args: unknown[]) => {
        h.eq(...args);
        return chain;
      },
      maybeSingle: async () => response,
      upsert: (...args: unknown[]) => {
        h.upsert(...args);
        return chain;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(response).then(resolve),
    };
    return chain;
  });
  h.auth.mockResolvedValue({
    supabase: { from: h.from },
    accountId: 'acct-1',
    userId: 'user-1',
  });
  h.fetchPolicies.mockResolvedValue('Shipping and return policies');
  h.ingest.mockResolvedValue(undefined);
});

describe('storefront training API', () => {
  it('reports readiness without disclosing credentials', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connected: true,
      product_count: 4,
      policies_imported_at: '2026-10-12',
    });
    expect(JSON.stringify(body)).not.toContain('encrypted');
    expect(h.eq).toHaveBeenCalledWith('account_id', 'acct-1');
  });
  it('requires admin authorization before importing anything', async () => {
    h.auth.mockRejectedValue(new Error('Forbidden'));
    expect((await POST()).status).toBe(403);
    expect(h.auth).toHaveBeenCalledWith('admin');
    expect(h.from).not.toHaveBeenCalled();
    expect(h.fetchPolicies).not.toHaveBeenCalled();
  });
  it('retraining writes the same managed document without enabling replies', async () => {
    expect((await POST()).status).toBe(200);
    const firstId = h.upsert.mock.calls[0][0].id;
    expect((await POST()).status).toBe(200);
    expect(h.upsert.mock.calls[1][0]).toMatchObject({
      id: firstId,
      account_id: 'acct-1',
      content: 'Shipping and return policies',
    });
    expect(
      h.from.mock.calls.every(([table]) =>
        ['shopify_config', 'ai_knowledge_documents'].includes(table)
      )
    ).toBe(true);
    expect(h.ingest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      { embeddingsApiKey: null },
      firstId,
      'Shipping and return policies'
    );
  });
  it('preserves existing training when fetching fails', async () => {
    h.fetchPolicies.mockRejectedValue(new Error('Shopify unavailable'));
    expect((await POST()).status).toBe(400);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.ingest).not.toHaveBeenCalled();
  });
  it('reports indexing failure instead of claiming training completed', async () => {
    h.ingest.mockRejectedValue(new Error('Indexing failed'));
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      saved: true,
      error: expect.stringContaining('Reindex'),
    });
  });
});
