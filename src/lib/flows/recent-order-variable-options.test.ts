import { describe, expect, it } from 'vitest';
import { recentOrderVariableOptions } from './recent-order-variable-options';
import { shopifyPayloadVariables } from './shopify-payload-variables';
import { interpolateTemplateString } from './template-interpolate';

describe('recent order variable picker', () => {
  it('inserts a property value that resolves to the image URL at runtime', () => {
    const url = 'https://cdn.example.com/design.png';
    const order = {
      line_items: [
        { properties: [{ name: '_tib_design_link_1', value: url }] },
      ],
    };
    const options = recentOrderVariableOptions(order);
    const design = options.find((option) => option.value === url)!;
    expect(design.label).toContain('_tib_design_link_1');
    expect(design.token).toBe(
      '{{ vars.shopify_order.line_items.0.properties.0.value }}'
    );
    expect(
      options.some((option) => option.path === 'line_items.0.properties.0')
    ).toBe(false);
    expect(
      interpolateTemplateString(design.token, shopifyPayloadVariables(order))
    ).toBe(url);
  });

  it('keeps scalar values while excluding object and array containers', () => {
    const options = recentOrderVariableOptions({
      name: 'GS123',
      quantity: 1,
      test: false,
      note: '',
      missing: null,
      empty: [],
      nested: { city: 'Chennai' },
    });
    expect(options.map((option) => option.path)).toEqual([
      'name',
      'quantity',
      'test',
      'note',
      'missing',
      'nested.city',
    ]);
    expect(options.map((option) => option.value)).toEqual([
      'GS123',
      '1',
      'false',
      '',
      'null',
      'Chennai',
    ]);
  });
});
