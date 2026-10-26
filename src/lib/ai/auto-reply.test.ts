import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiConfig } from './types';
import {
  ProductCarouselAlreadySentError,
  ProductCarouselDeliveryUncertainError,
} from '@/lib/shopify/product-delivery-error';

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  retrieveShopifyContext: vi.fn(),
  searchRecommendedProducts: vi.fn(),
  sendShopifyProductCarousel: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    store: {
      status: 'connected',
      shop_domain: 'gifts.myshopify.com',
      sell_on_whatsapp_enabled: true,
    },
  },
}));

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock('@/lib/auth/brand-accounts', () => ({
  fetchAccountWithCategory: vi
    .fn()
    .mockResolvedValue({ ai_agents_enabled: true }),
  isMissingColumnError: () => false,
}));
vi.mock('./store-profile', () => ({
  loadStoreProfile: vi.fn().mockResolvedValue(null),
}));
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
}));
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }));
vi.mock('./shopify-context', () => ({
  retrieveShopifyContext: h.retrieveShopifyContext,
}));
vi.mock('./product-recommendations', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./product-recommendations')>();
  return {
    ...actual,
    searchRecommendedProducts: h.searchRecommendedProducts,
    resolveRecommendedProducts: h.searchRecommendedProducts,
  };
});
vi.mock('@/lib/shopify/send-product-carousel', () => ({
  sendShopifyProductCarousel: h.sendShopifyProductCarousel,
}));
vi.mock('./generate', () => ({ generateReply: h.generateReply }));
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }));
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'shopify_config') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: h.state.store, error: null }),
        };
        return chain;
      }
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        };
        return chain;
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: h.state.claim, error: null });
    },
  }),
}));

import { dispatchInboundToAiReply } from './auto-reply';

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
};

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  };
  h.state.autoResponders = [];
  h.state.claim = true;
  h.state.updatePayload = null;
  h.state.rpcCalls = [];
  h.state.store = {
    status: 'connected',
    shop_domain: 'gifts.myshopify.com',
    sell_on_whatsapp_enabled: true,
  };
  h.loadAiConfig.mockResolvedValue(aiConfig());
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'hi' },
  ]);
  h.retrieveKnowledge.mockResolvedValue([]);
  h.retrieveShopifyContext.mockResolvedValue(null);
  h.searchRecommendedProducts.mockResolvedValue([]);
  h.sendShopifyProductCarousel.mockResolvedValue({
    message_id: 'msg-carousel',
    whatsapp_message_id: 'wamid.carousel',
    product_count: 2,
  });
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false });
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' });
});

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('passes customer constraints to catalog resolution', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show hoodies under INR 1500 size XL' },
    ]);
    await dispatchInboundToAiReply(ARGS);
    expect(h.searchRecommendedProducts).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'hoodies',
      [],
      undefined,
      expect.objectContaining({ maxPrice: 1500, currency: 'INR', size: 'xl' })
    );
  });
  it('delivers a single matched product as text with a catalog link', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue([
      {
        shopify_variant_id: 101,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: null,
      },
    ]);
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendShopifyProductCarousel).not.toHaveBeenCalled();
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('https://gifts.myshopify.com/cart/101:1'),
      })
    );
    expect(h.generateReply.mock.calls[0][0].systemPrompt).not.toContain(
      'nothing in the synced catalogue closely matches'
    );
  });
  it('includes products in the text fallback after a carousel send fails', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue(
      [101, 102].map((id) => ({
        shopify_variant_id: id,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: 'https://cdn.test/hoodie.jpg',
      }))
    );
    h.sendShopifyProductCarousel.mockRejectedValueOnce(
      new Error('Meta unavailable')
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('/cart/102:1') })
    );
  });
  it('provides catalog details without checkout links when product sends are switched off', async () => {
    h.state.store.sell_on_whatsapp_enabled = false;
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue(
      [101, 102].map((id) => ({
        shopify_variant_id: id,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: 'https://cdn.test/hoodie.jpg',
      }))
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendShopifyProductCarousel).not.toHaveBeenCalled();
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('INR 900') })
    );
    expect(h.engineSendText.mock.calls[0][0].text).not.toContain('/cart/');
  });
  it('does not duplicate a carousel accepted by Meta when local persistence fails', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue(
      [101, 102].map((id) => ({
        shopify_variant_id: id,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: 'https://cdn.test/hoodie.jpg',
      }))
    );
    h.sendShopifyProductCarousel.mockRejectedValueOnce(
      new ProductCarouselAlreadySentError('wamid.1', new Error('DB down'))
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
  it('does not send fallback text for an uncertain network outcome', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue(
      [101, 102].map((id) => ({
        shopify_variant_id: id,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: 'https://cdn.test/hoodie.jpg',
      }))
    );
    h.sendShopifyProductCarousel.mockRejectedValueOnce(
      new ProductCarouselDeliveryUncertainError(new TypeError('fetch failed'))
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
  it('does not attach shopping links when the model hands off', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Show me hoodies' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue([
      {
        shopify_variant_id: 101,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
      },
    ]);
    h.generateReply.mockResolvedValueOnce({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    // Only the handoff notice goes out — no product links.
    expect(h.engineSendText).toHaveBeenCalledTimes(1);
    expect(h.engineSendText.mock.calls[0][0].text).not.toContain('myshopify.com');
    expect(h.sendShopifyProductCarousel).not.toHaveBeenCalled();
  });
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ]);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' })
    );
  });

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.']);
    await dispatchInboundToAiReply(ARGS);
    expect(h.retrieveKnowledge).toHaveBeenCalled();
    const systemPrompt = h.generateReply.mock.calls[0][0]
      .systemPrompt as string;
    expect(systemPrompt).toContain('Returns accepted within 30 days.');
  });

  it('sends a product carousel when catalog matches are found', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'show me your best sellers' },
    ]);
    h.searchRecommendedProducts.mockResolvedValue([
      {
        shopify_variant_id: 101,
        title: 'Shirt',
        price: '500',
        currency: 'INR',
        image_url: 'https://cdn.test/1.jpg',
      },
      {
        shopify_variant_id: 102,
        title: 'Hoodie',
        price: '900',
        currency: 'INR',
        image_url: 'https://cdn.test/2.jpg',
      },
    ]);
    h.generateReply.mockResolvedValue({
      text: 'Here are a few picks you might like!',
      handoff: false,
    });

    await dispatchInboundToAiReply(ARGS);

    expect(h.sendShopifyProductCarousel).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: 'Here are a few picks you might like!',
        shopifyVariantIds: [101, 102],
        aiGenerated: true,
      })
    );
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('grounds the reply in synced Shopify orders', async () => {
    h.retrieveShopifyContext.mockResolvedValue(
      'Order #1042\n- Items: Blue T-Shirt'
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.retrieveShopifyContext).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'contact-1',
      { refresh: false }
    );
    const systemPrompt = h.generateReply.mock.calls[0][0]
      .systemPrompt as string;
    expect(systemPrompt).toContain('Order #1042');
  });

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false;
    await dispatchInboundToAiReply(ARGS);
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }));
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).not.toHaveBeenCalled();
  });

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([]);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.engineSendText).not.toHaveBeenCalled();
  });
});

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and tells the customer on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('passing this to our team'),
        aiGenerated: true,
      })
    );
    // The notice doesn't consume an auto-reply slot.
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
    });
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off'
    );
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id');
  });

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }));
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    });
  });

  it("sends the brand's own handoff message when set", async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ handoffMessage: 'One sec — connecting you to Priya.' })
    );
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText.mock.calls[0][0].text).toBe(
      'One sec — connecting you to Priya.'
    );
  });

  it("sends the agent's reply before the handoff line", async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sorry it arrived broken! Please share your order number and a photo.',
      handoff: true,
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.engineSendText).toHaveBeenCalledTimes(1);
    expect(h.engineSendText.mock.calls[0][0].text).toBe(
      "Sorry it arrived broken! Please share your order number and a photo.\n\nThanks for your patience! I'm passing this to our team — someone will reply here shortly."
    );
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true });
  });

  it('hands off instead of going silent when the provider fails', async () => {
    const { AiError } = await import('./types');
    h.generateReply.mockRejectedValue(
      new AiError('bad key', { code: 'invalid_key', status: 401 })
    );
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true });
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'rejected the API key'
    );
    expect(h.engineSendText).toHaveBeenCalledTimes(1);
  });

  it('clears a flow goal when handing off', async () => {
    h.state.conv = { ...h.state.conv, ai_flow_goal: 'Recover the checkout' };
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.updatePayload).toMatchObject({ ai_flow_goal: null });
  });

  it('passes the flow goal into the system prompt', async () => {
    h.state.conv = { ...h.state.conv, ai_flow_goal: 'Recover the checkout' };
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain(
      'Recover the checkout'
    );
  });
});
