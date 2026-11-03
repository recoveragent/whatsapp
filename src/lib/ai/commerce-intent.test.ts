import { describe, expect, it } from 'vitest';
import {
  isNewPurchaseQuery,
  isOrderSupportQuery,
  shouldRefreshShopifyOrders,
} from './commerce-intent';
import { buildSystemPrompt } from './defaults';

describe('order support routing', () => {
  it.each([
    'want to order baby birth frame',
    'I would like to order a hoodie',
    'Can I order a sofa?',
    'How do I order a serum?',
    'I am ready to place a new order for headphones',
  ])('recognizes a new purchase across product categories: %s', (content) => {
    expect(isNewPurchaseQuery(content)).toBe(true);
    expect(isOrderSupportQuery(content)).toBe(false);
    expect(
      shouldRefreshShopifyOrders([
        { role: 'user', content: 'Where is my order?' },
        { role: 'user', content },
      ])
    ).toBe(false);
  });
  it.each([
    'I want to order but my payment was charged twice',
    'Can I order a refund?',
    'I want to order a hoodie but cancel my order first',
    'I want to order but where is my order?',
    'I want to order status',
  ])('keeps existing-order problems in support: %s', (content) => {
    expect(isNewPurchaseQuery(content)).toBe(false);
    expect(isOrderSupportQuery(content)).toBe(true);
  });
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
  it('prioritizes the supplied catalog choices over a generic website redirect', () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      productRecommendations: 'Products from the current brand catalog',
      productDelivery: 'carousel',
    });
    expect(prompt).toContain(
      'help the customer choose from these matched products here first'
    );
    expect(prompt).toContain('Only direct them to checkout');
  });
});
