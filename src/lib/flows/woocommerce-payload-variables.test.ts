import { describe, expect, it } from 'vitest';
import { contextFromOrder } from '@/lib/woocommerce/extract-event-context';
import { shopifyPayloadVariables } from './shopify-payload-variables';
import { recentOrderVariableOptions } from './recent-order-variable-options';
import { interpolateTemplateString } from './template-interpolate';
import { templateVariableGroupsForFlow } from './template-variables';

describe('WooCommerce trigger payload variables', () => {
  it('resolves selected nested fields from each triggering order', () => {
    const sample = {
      id: 1,
      billing: { first_name: 'Ada' },
      line_items: [{ name: 'Tea' }],
      total: '0',
      paid: false,
      note: null,
    };
    const context = contextFromOrder(sample, 'https://brand.test');
    expect(context.triggerPayload).toBe(sample);
    const token = recentOrderVariableOptions(sample, 'woocommerce_order').find(
      (field) => field.path === 'line_items.0.name'
    )!.token;
    const vars = shopifyPayloadVariables(
      { ...sample, line_items: [{ name: 'Coffee' }] },
      'woocommerce_order'
    );
    expect(interpolateTemplateString(token, vars)).toBe('Coffee');
    expect(
      interpolateTemplateString(
        '{{ vars.woocommerce_order.total }} / {{ vars.woocommerce_order.paid }} / {{ vars.woocommerce_order.note }}',
        vars
      )
    ).toBe('0 / false / ');
    expect(vars['woocommerce_order.line_items']).toBe('[{"name":"Coffee"}]');
  });

  it('offers WooCommerce samples only on WooCommerce order triggers', () => {
    for (const trigger of [
      'woocommerce_order_placed',
      'woocommerce_order_updated',
      'woocommerce_order_cancelled',
    ] as const) {
      expect(
        templateVariableGroupsForFlow(trigger).find(
          (group) => group.id === 'trigger'
        )?.recentWooCommerceOrders
      ).toBe(true);
    }
    for (const trigger of ['keyword', 'shopify_order_placed'] as const) {
      expect(
        templateVariableGroupsForFlow(trigger).some(
          (group) => group.recentWooCommerceOrders
        )
      ).toBe(false);
    }
  });
});
