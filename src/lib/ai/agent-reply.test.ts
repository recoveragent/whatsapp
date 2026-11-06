import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAgentReply } from './agent-reply';
import { AiError, type AiConfig } from './types';

const h = vi.hoisted(() => ({
  generateReply: vi.fn(),
  retrieveKnowledge: vi.fn(),
  retrieveShopifyContext: vi.fn(),
}));

vi.mock('./generate', () => ({ generateReply: h.generateReply }));
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }));
vi.mock('./shopify-context', () => ({
  retrieveShopifyContext: h.retrieveShopifyContext,
}));
vi.mock('./store-profile', () => ({ loadStoreProfile: async () => null }));
vi.mock('./reply-guidance', () => ({
  loadReplyGuidance: async () => [],
  formatReplyGuidance: () => null,
}));

const baseArgs = {
  db: {} as SupabaseClient,
  accountId: 'acct-1',
  config: { systemPrompt: null } as unknown as AiConfig,
  messages: [{ role: 'user' as const, content: 'What are your hours?' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.retrieveKnowledge.mockResolvedValue([]);
  h.retrieveShopifyContext.mockResolvedValue('ORDER #1001 shipped');
  h.generateReply.mockResolvedValue({
    text: 'We open at 9.',
    handoff: false,
    usage: null,
    quickReplies: ['Thanks'],
  });
});

describe('generateAgentReply', () => {
  it('retrieves no order data without a verified contact', async () => {
    const outcome = await generateAgentReply(baseArgs);

    expect(h.retrieveShopifyContext).not.toHaveBeenCalled();
    expect(h.generateReply.mock.calls[0][0].systemPrompt).not.toContain(
      'ORDER #1001'
    );
    expect(outcome.status).toBe('generated');
  });

  it('grounds the reply in orders for a verified contact', async () => {
    await generateAgentReply({ ...baseArgs, verifiedContactId: 'contact-1' });

    expect(h.retrieveShopifyContext).toHaveBeenCalledWith(
      baseArgs.db,
      'acct-1',
      'contact-1',
      expect.any(Object)
    );
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain(
      'ORDER #1001'
    );
  });

  it('keeps the WhatsApp prompt by default', async () => {
    await generateAgentReply(baseArgs);

    const { systemPrompt } = h.generateReply.mock.calls[0][0];
    expect(systemPrompt).toContain('recent WhatsApp conversation');
    expect(systemPrompt).not.toContain('Website chat rule');
  });

  it('tells the website agent where it is and not to collect order numbers', async () => {
    await generateAgentReply({ ...baseArgs, channel: 'website' });

    const { systemPrompt } = h.generateReply.mock.calls[0][0];
    expect(systemPrompt).not.toMatch(/whatsapp/i);
    expect(systemPrompt).toContain('chat widget');
    expect(systemPrompt).toContain('do not ask for an order number');
  });

  it('returns the reply for the channel to deliver', async () => {
    const outcome = await generateAgentReply(baseArgs);

    expect(outcome).toEqual({
      status: 'generated',
      reply: {
        text: 'We open at 9.',
        handoff: false,
        quickReplies: ['Thanks'],
        usage: null,
        recommendedProducts: [],
        recommendationStore: null,
        hasProductCards: false,
      },
    });
  });

  it('reports a provider failure without throwing', async () => {
    const error = new AiError('bad key', { code: 'invalid_key', status: 401 });
    h.generateReply.mockRejectedValue(error);

    await expect(generateAgentReply(baseArgs)).resolves.toEqual({
      status: 'generation_failed',
      error,
    });
  });

  it('throws when retrieval fails, so it is not mistaken for a provider failure', async () => {
    h.retrieveKnowledge.mockRejectedValue(new Error('db down'));

    await expect(generateAgentReply(baseArgs)).rejects.toThrow('db down');
    expect(h.generateReply).not.toHaveBeenCalled();
  });
});
