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
      '{{ vars.shopify_order.line_items.0.properties.tib_design_link_1 }}'
    );
    expect(
      options.some((option) => option.path === 'line_items.0.properties.0')
    ).toBe(false);
    expect(
      interpolateTemplateString(design.token, shopifyPayloadVariables(order))
    ).toBe(url);
  });

  it('selects properties by name, so reordering them keeps the token working', () => {
    const sample = {
      line_items: [
        {
          properties: [
            { name: 'Parents name', value: 'Ravi & Priya' },
            { name: 'Parents photo', value: 'https://cdn.test/a.png' },
            { name: '_Parents photo - original', value: 'https://cdn.test/a-orig.png' },
          ],
        },
      ],
    };
    const options = recentOrderVariableOptions(sample);
    const photo = options.find((o) => o.value === 'https://cdn.test/a.png')!;
    expect(photo.token).toBe(
      '{{ vars.shopify_order.line_items.0.properties.parents_photo }}'
    );
    expect(photo.label).toBe(
      'Parents photo (line_items.0.properties.parents_photo)'
    );
    expect(options.some((o) => o.path.endsWith('.name'))).toBe(false);
    expect(
      options.find((o) => o.value === 'https://cdn.test/a-orig.png')!.token
    ).toBe(
      '{{ vars.shopify_order.line_items.0.properties.parents_photo_original }}'
    );

    // A later order has an extra property first and a different order.
    const later = {
      line_items: [
        {
          properties: [
            { name: 'Baby name', value: 'Anu' },
            { name: 'Parents photo', value: 'https://cdn.test/b.png' },
            { name: 'Parents name', value: 'Kumar' },
          ],
        },
      ],
    };
    const vars = shopifyPayloadVariables(later);
    expect(interpolateTemplateString(photo.token, vars)).toBe(
      'https://cdn.test/b.png'
    );
    // Positional tokens saved before this change still resolve.
    expect(
      interpolateTemplateString(
        '{{ vars.shopify_order.line_items.0.properties.2.value }}',
        vars
      )
    ).toBe('Kumar');
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
