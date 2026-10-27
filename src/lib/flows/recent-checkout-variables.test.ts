import { describe, expect, it } from 'vitest';
import { checkoutVariablePayload } from './recent-checkout-variables';
import { recentOrderVariableOptions } from './recent-order-variable-options';
import { enrichCheckoutAppWebhookVars } from './checkout-app-webhook';
import { interpolateTemplateString } from './template-interpolate';
import { fastrrPayload } from '@/lib/shopify/fastrr-checkout.fixture';

const design = 'https://cdn.teeinblue.com/customizations/test.jpg';

describe('recent checkout variables', () => {
  it('uses the same payload a Recover Agent mirror flattens at run time', () => {
    const saved = fastrrPayload();
    expect(checkoutVariablePayload(saved)).toBe(saved.event.raw);
    const event = { amount: 1, phone: '919876543210' };
    expect(
      checkoutVariablePayload({ _wa_recover_agent_mirror: true, event })
    ).toBe(event);
  });

  it('uses a native Shopify checkout as saved', () => {
    const checkout = { id: 1, line_items: [{ variant_id: 2 }] };
    expect(checkoutVariablePayload(checkout)).toBe(checkout);
    expect(checkoutVariablePayload(null)).toEqual({});
  });

  it('offers Fastrr custom_attributes paths that resolve when the flow runs', () => {
    const saved = fastrrPayload({
      custom_attributes: { _customization_image: design },
    });
    const option = recentOrderVariableOptions(
      checkoutVariablePayload(saved)
    ).find((o) => o.path.endsWith('custom_attributes._customization_image'));
    expect(option?.token).toBe(
      '{{ vars.shopify_order.items.0.custom_attributes._customization_image }}'
    );
    const vars = enrichCheckoutAppWebhookVars(saved.event.raw, {});
    expect(interpolateTemplateString(option!.token, vars)).toBe(design);
  });
});
