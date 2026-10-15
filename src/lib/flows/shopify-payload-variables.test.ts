import { describe, expect, it } from 'vitest';
import { shopifyPayloadVariables } from './shopify-payload-variables';
import { interpolateTemplateString } from './template-interpolate';
import { templateVariableGroupsForFlow, templateVariableGroupsForAutomation } from './template-variables';
import { contextFromOrder, contextFromCheckout, contextFromFulfillment } from '@/lib/shopify/extract-context';

describe('recent Shopify order variables', () => {
  it('resolves nested fields, arrays, false, zero and null from the current payload', () => {
    const payload = { customer: { first_name: 'Ada' }, line_items: [{ title: 'Tea' }], total: 0, confirmed: false, note: null };
    const vars = shopifyPayloadVariables(payload);
    expect(interpolateTemplateString('{{ vars.shopify_order.customer.first_name }}: {{ vars.shopify_order.line_items.0.title }} / {{ vars.shopify_order.total }} / {{ vars.shopify_order.confirmed }} / {{ vars.shopify_order.note }}', vars)).toBe('Ada: Tea / 0 / false / ');
    expect(vars['shopify_order.line_items']).toBe(JSON.stringify(payload.line_items));
    expect(shopifyPayloadVariables(undefined)).toEqual({});
  });

  it('enables samples only for Shopify flows', () => {
    for (const trigger of ['shopify_order_placed', 'shopify_order_fulfilled', 'shopify_checkout_abandoned', 'shopify_checkout_app_abandoned'] as const) {
      expect(templateVariableGroupsForFlow(trigger).find(group => group.id === 'trigger')?.recentShopifyOrders).toBe(true);
    }
    expect(templateVariableGroupsForFlow('keyword').some(group => group.recentShopifyOrders)).toBe(false);
    expect(templateVariableGroupsForAutomation('shopify_order_placed').some(group => group.recentShopifyOrders)).toBe(false);
  });

  it('preserves the resource payload through order, checkout and fulfillment contexts', () => {
    const order = { id: 123, customer: { first_name: 'Ada' } };
    expect(contextFromOrder(order, 'shop').triggerPayload).toBe(order);
    expect(contextFromCheckout(order, 'shop').triggerPayload).toBe(order);
    expect(contextFromFulfillment({ id: 456, order_id: 123 }, order, 'shop').triggerPayload).toBe(order);
  });
});
