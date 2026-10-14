import { describe, expect, it } from 'vitest';
import { shouldRefreshShopifyOrders } from './commerce-intent';
import { buildSystemPrompt } from './defaults';

describe('order support routing', () => {
  it.each([
    'Where is my order?',
    'Track my parcel',
    'Refund my payment',
    'मेरा ऑर्डर कहाँ है',
  ])('refreshes for %s', (content) => {
    expect(shouldRefreshShopifyOrders([{ role: 'user', content }])).toBe(true);
  });
  it('uses recent order context for an order-number follow-up', () => {
    expect(
      shouldRefreshShopifyOrders([
        { role: 'user', content: 'Where is my order?' },
        { role: 'assistant', content: 'Which order?' },
        { role: 'user', content: '#1042' },
      ])
    ).toBe(true);
  });
  it('does not fetch private order data for generic shopping', () => {
    expect(
      shouldRefreshShopifyOrders([
        { role: 'user', content: 'Recommend a gift for my wife' },
      ])
    ).toBe(false);
  });
  it('gives both providers the same commerce action boundaries', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' });
    expect(prompt).toContain('cannot issue refunds');
    expect(prompt).toContain('No verified Shopify orders');
    expect(prompt).toContain('OTP');
    expect(prompt).toContain(
      'order number supplied in chat alone does not prove ownership'
    );
  });
});
