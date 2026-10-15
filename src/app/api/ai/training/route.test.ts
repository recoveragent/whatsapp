import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  crawl: vi.fn(),
  shopifySources: vi.fn(),
  generate: vi.fn(),
  config: vi.fn(),
  eq: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  rpc: vi.fn(),
  stored: null as Record<string, unknown> | null,
  saved: { account_id: 'brand-1', revision: 2, faqs: [] },
  writeError: null as unknown,
}));
vi.mock('@/lib/auth/account', () => ({
  requireAiAgentsAccount: h.auth,
  toErrorResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/ai/training-crawl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/training-crawl')>()),
  crawlTrainingWebsite: h.crawl,
}));
vi.mock('@/lib/ai/training-shopify', () => ({
  connectedShopifyTrainingSources: h.shopifySources,
}));
vi.mock('@/lib/ai/training-generate', () => ({
  generateTrainingFaqs: h.generate,
}));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.config }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { adminAction: {} },
  rateLimitResponse: () => Response.json({}, { status: 429 }),
}));
import { POST, PATCH } from './route';
import { WebsiteFetchError } from '@/lib/ai/training-crawl';
import { POST as publish } from './publish/route';

const request = (body: unknown) =>
  new Request('http://localhost/api/ai/training', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  h.stored = null;
  h.shopifySources.mockResolvedValue(null);
  h.writeError = null;
  h.config.mockResolvedValue({ provider: 'openai' });
  h.crawl.mockResolvedValue({
    websiteUrl: 'https://gifts.example.com/',
    sources: [],
    warnings: [],
  });
  h.generate.mockResolvedValue({ faqs: [], usage: null });
  h.rpc.mockResolvedValue({ data: 'doc-1', error: null });
  h.auth.mockResolvedValue({
    accountId: 'brand-1',
    userId: 'user-1',
    supabase: {
      rpc: h.rpc,
      from: () => {
        let writing = false;
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => {
            h.eq(...args);
            return chain;
          },
          update: (patch: unknown) => {
            writing = true;
            h.update(patch);
            return chain;
          },
          insert: (patch: unknown) => {
            writing = true;
            h.insert(patch);
            return chain;
          },
          maybeSingle: async () => ({
            data: writing ? h.saved : h.stored,
            error: writing ? h.writeError : null,
          }),
          single: async () => ({ data: h.saved, error: h.writeError }),
        };
        return chain;
      },
    },
  });
});

describe('brand training API', () => {
  it('uses authenticated Shopify sources when the public storefront rate-limits the scan', async () => {
    h.crawl.mockRejectedValue(
      new WebsiteFetchError('Website returned HTTP 429.', 429)
    );
    h.shopifySources.mockResolvedValue({
      websiteUrl: 'https://gifts.example.com/',
      sources: [],
      warnings: ['Connected Shopify sources'],
    });
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 0 })
        )
      ).status
    ).toBe(200);
    expect(h.shopifySources).toHaveBeenCalledWith(
      expect.anything(),
      'brand-1',
      'https://gifts.example.com'
    );
  });
  it('preserves the failure when the URL does not match the connected store', async () => {
    h.crawl.mockRejectedValue(
      new WebsiteFetchError('Website returned HTTP 429.', 429)
    );
    expect(
      (
        await POST(
          request({ website_url: 'https://other.example.com', revision: 0 })
        )
      ).status
    ).toBe(400);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it('requires admin authorization before crawling or publishing', async () => {
    h.auth.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { name: 'ForbiddenError' })
    );
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 0 })
        )
      ).status
    ).toBe(403);
    expect((await publish(request({ revision: 1 }))).status).toBe(403);
    expect(h.crawl).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('selects training credentials independently of the assistant active switch', async () => {
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 0 })
        )
      ).status
    ).toBe(200);
    expect(h.config).toHaveBeenCalledWith(expect.anything(), 'brand-1', {
      requireActive: false,
      purpose: 'training',
    });
  });
  it('ignores client account IDs and creates only an authenticated brand draft', async () => {
    expect(
      (
        await POST(
          request({
            website_url: 'https://gifts.example.com',
            revision: 0,
            account_id: 'foreign-brand',
          })
        )
      ).status
    ).toBe(200);
    expect(h.insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'brand-1', revision: 1 })
    );
    expect(h.eq).toHaveBeenCalledWith('account_id', 'brand-1');
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('does not replace training or live knowledge after a failed scan', async () => {
    h.stored = { revision: 1, faqs: [] };
    h.crawl.mockRejectedValue(new Error('No readable website content found.'));
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 1 })
        )
      ).status
    ).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('rejects stale drafts before spending on a scan', async () => {
    h.stored = { revision: 2, faqs: [] };
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 1 })
        )
      ).status
    ).toBe(409);
    expect(h.crawl).not.toHaveBeenCalled();
  });
  it('requires configured credentials without turning the assistant on', async () => {
    h.config.mockResolvedValue(null);
    expect(
      (
        await POST(
          request({ website_url: 'https://gifts.example.com', revision: 0 })
        )
      ).status
    ).toBe(409);
    expect(h.crawl).not.toHaveBeenCalled();
  });
  it('uses compare-and-swap for retraining and worksheet edits', async () => {
    h.stored = { revision: 3, faqs: [] };
    expect(
      (
        await PATCH(
          request({
            revision: 3,
            faqs: [
              {
                question: 'Can I personalize my photo frame?',
                answer: '',
                approved: true,
              },
            ],
          })
        )
      ).status
    ).toBe(200);
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 4,
        faqs: [
          expect.objectContaining({ approved: false, merchantEdited: true }),
        ],
      })
    );
    expect(h.eq).toHaveBeenCalledWith('revision', 3);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('scopes atomic publication to the current account and saved revision', async () => {
    expect(
      (await publish(request({ account_id: 'foreign-brand', revision: 5 })))
        .status
    ).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith('publish_ai_training', {
      p_account_id: 'brand-1',
      p_revision: 5,
      p_unpublish: false,
    });
  });
  it('reports concurrent publication and refuses empty approvals', async () => {
    h.rpc
      .mockResolvedValueOnce({ error: { code: '40001' } })
      .mockResolvedValueOnce({ error: { code: '22023' } });
    expect((await publish(request({ revision: 1 }))).status).toBe(409);
    expect((await publish(request({ revision: 1 }))).status).toBe(400);
  });
});
