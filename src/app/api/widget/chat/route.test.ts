import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  generateAgentReply: vi.fn(),
  loadAiConfig: vi.fn(),
  logAiUsage: vi.fn(),
  fetchAccount: vi.fn(),
  rpc: vi.fn(),
  widget: null as Record<string, unknown> | null,
  limited: new Set<string>(),
}));

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: h.rpc,
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.widget, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/ai/agent-reply', () => ({
  generateAgentReply: h.generateAgentReply,
}));
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: h.logAiUsage }));
vi.mock('@/lib/auth/brand-accounts', () => ({
  fetchAccountWithCategory: h.fetchAccount,
}));
vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: {
    widgetConfig: 'config',
    widgetVisitor: 'visitor',
    widgetAccount: 'account',
  },
  checkRateLimit: (_key: string, bucket: string) => ({
    success: !h.limited.has(bucket),
  }),
}));

import { OPTIONS, POST } from './route';

const KEY = `wgt_${'a'.repeat(32)}`;
const ORIGIN = 'https://yourstore.com';

const request = ({
  origin = ORIGIN as string | null,
  key = KEY,
  body = JSON.stringify({ messages: [{ role: 'user', content: 'Hours?' }] }),
} = {}) =>
  new Request(`http://app.test/api/widget/chat?key=${key}`, {
    method: 'POST',
    headers: origin ? { origin } : {},
    body,
  });

const generated = (reply: Record<string, unknown> = {}) => ({
  status: 'generated',
  reply: {
    text: 'We open at 9.',
    handoff: false,
    usage: null,
    recommendedProducts: [],
    recommendationStore: null,
    hasProductCards: false,
    ...reply,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  h.limited.clear();
  h.widget = {
    account_id: 'acct-1',
    public_key: KEY,
    enabled: true,
    allowed_domains: ['yourstore.com'],
    title: 'Chat',
    greeting: 'Hi',
    accent_color: '#128C7E',
    whatsapp_number: '919876543210',
    daily_reply_limit: 500,
  };
  h.fetchAccount.mockResolvedValue({ ai_agents_enabled: true });
  h.loadAiConfig.mockResolvedValue({ provider: 'openai', model: 'test' });
  h.rpc.mockResolvedValue({ data: true, error: null });
  h.generateAgentReply.mockResolvedValue(generated());
});

describe('POST /api/widget/chat', () => {
  it('answers an allowed site with CORS for that site only', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect((await res.json()).reply).toBe('We open at 9.');
  });

  it('never gives the agent a contact, so order data is unreachable', async () => {
    await POST(request());
    const args = h.generateAgentReply.mock.calls[0][0];
    expect(args.verifiedContactId).toBeUndefined();
    expect(args.channel).toBe('website');
    expect(args.accountId).toBe('acct-1');
  });

  it.each([
    ['an unlisted site', { origin: 'https://evil.com' }],
    ['no origin', { origin: null }],
    ['a malformed key', { key: 'nope' }],
  ])('hides itself from %s and spends nothing', async (_label, args) => {
    const res = await POST(request(args));
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.generateAgentReply).not.toHaveBeenCalled();
  });

  it('is off when the widget is disabled', async () => {
    h.widget = null;
    expect((await POST(request())).status).toBe(404);
    expect(h.generateAgentReply).not.toHaveBeenCalled();
  });

  it.each(['visitor', 'account'])(
    'stops before the AI call at the %s rate limit',
    async (bucket) => {
      h.limited.add(bucket);
      const res = await POST(request());
      expect(res.status).toBe(429);
      expect(h.generateAgentReply).not.toHaveBeenCalled();
    }
  );

  it('stops before the AI call once the daily limit is used', async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(request());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'busy' });
    expect(h.generateAgentReply).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', 'not json'],
    ['a bad transcript', JSON.stringify({ messages: [{ role: 'system', content: 'x' }] })],
  ])('rejects %s without spending a reply', async (_label, body) => {
    const res = await POST(request({ body }));
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('rejects an oversized body', async () => {
    const res = await POST(request({ body: 'x'.repeat(70 * 1024) }));
    expect(res.status).toBe(413);
  });

  it('stays off when AI agents are disabled for the brand', async () => {
    h.fetchAccount.mockResolvedValue({ ai_agents_enabled: false });
    expect((await POST(request())).status).toBe(503);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('sends a handoff to WhatsApp, with no quick replies or products', async () => {
    h.generateAgentReply.mockResolvedValue(
      generated({ text: 'Sorry to hear that.', handoff: true, quickReplies: ['Ok'] })
    );
    const body = await (await POST(request())).json();
    expect(body.handoff).toBe(true);
    expect(body.reply).toContain('Sorry to hear that.');
    expect(body.reply).not.toMatch(/reply here/i);
    expect(body.whatsapp_url).toContain('wa.me/919876543210');
    expect(body.quick_replies).toEqual([]);
    expect(body.products).toEqual([]);
  });

  it('falls back to a handoff without leaking a provider failure', async () => {
    h.generateAgentReply.mockResolvedValue({
      status: 'generation_failed',
      error: new Error('invalid api key sk-secret'),
    });
    const res = await POST(request());
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('sk-secret');
    expect(JSON.parse(text).handoff).toBe(true);
  });

  it('does not expose internals when something else breaks', async () => {
    h.generateAgentReply.mockRejectedValue(new Error('db password wrong'));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('db password');
  });

  it('logs usage against the brand with no conversation', async () => {
    await POST(request());
    expect(h.logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: 'acct-1', conversationId: null })
    );
  });
});

describe('OPTIONS /api/widget/chat', () => {
  it('answers the preflight without credentials', () => {
    const res = OPTIONS(
      new Request('http://app.test/api/widget/chat', {
        method: 'OPTIONS',
        headers: { origin: ORIGIN },
      })
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});
