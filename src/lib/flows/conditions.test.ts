import { describe, expect, it } from 'vitest';
import {
  compareCondition,
  conditionPath,
  shopifyConditionFields,
  validateConditionPredicate,
} from './conditions';
import {
  shopifyConditionData,
  resolveShopifyConditionValue,
} from '@/lib/shopify/condition-data';
import {
  contextFromOrder,
  contextFromFulfillment,
} from '@/lib/shopify/extract-context';
import { validateFlowForActivation } from './validate';
import type { ConditionPredicate } from './types';

const rule = (patch: Partial<ConditionPredicate> = {}): ConditionPredicate => ({
  subject: 'shopify_order',
  subject_key: 'total',
  operator: 'gte',
  value: '2000',
  ...patch,
});

describe('typed comparisons', () => {
  it('compares money numerically and rejects formatted/invalid money', () => {
    expect(
      compareCondition({
        operator: 'gte',
        subjectValue: '10000.50',
        configValue: '2000',
      })
    ).toBe(true);
    expect(
      compareCondition({
        operator: 'gte',
        subjectValue: 'INR 10000.50',
        configValue: '2000',
      })
    ).toBe(false);
    expect(
      compareCondition({ operator: 'gte', subjectValue: '', configValue: '0' })
    ).toBe(false);
    expect(
      compareCondition({
        operator: 'equals',
        subjectValue: 2000,
        configValue: '2000.00',
        type: 'number',
      })
    ).toBe(true);
  });
  it('uses inclusive range boundaries', () => {
    for (const subjectValue of [2, 3, 5])
      expect(
        compareCondition({
          operator: 'between',
          subjectValue,
          configValue: '2',
          valueTo: '5',
        })
      ).toBe(true);
    expect(
      compareCondition({
        operator: 'between',
        subjectValue: 6,
        configValue: '2',
        valueTo: '5',
      })
    ).toBe(false);
  });
  it('matches list members exactly, not as substrings', () => {
    expect(
      compareCondition({
        operator: 'contains',
        subjectValue: ['VIP-new'],
        configValue: 'VIP',
      })
    ).toBe(false);
    expect(
      compareCondition({
        operator: 'contains_all',
        subjectValue: ['A', 'B'],
        configValue: 'A, B',
      })
    ).toBe(true);
    expect(
      compareCondition({
        operator: 'contains_any',
        subjectValue: ['A'],
        configValue: 'B, A',
      })
    ).toBe(true);
    expect(
      compareCondition({
        operator: 'contains_all',
        subjectValue: [],
        configValue: '',
      })
    ).toBe(false);
  });
  it('compares dates across timezones', () => {
    expect(
      compareCondition({
        operator: 'before',
        subjectValue: '2026-10-13T12:00:00+05:30',
        configValue: '2026-10-13T07:00:00Z',
      })
    ).toBe(true);
    expect(
      compareCondition({
        operator: 'after',
        subjectValue: 'invalid',
        configValue: '2026-10-13T07:00:00Z',
      })
    ).toBe(false);
  });
  it('handles false and zero as present; preserves legacy undefined inequality', () => {
    for (const subjectValue of [false, 0])
      expect(compareCondition({ operator: 'present', subjectValue })).toBe(
        true
      );
    expect(compareCondition({ operator: 'absent', subjectValue: [] })).toBe(
      true
    );
    expect(
      compareCondition({
        operator: 'not_equals',
        subjectValue: undefined,
        configValue: 'x',
      })
    ).toBe(true);
    expect(
      compareCondition({
        operator: 'starts_with',
        subjectValue: '400001',
        configValue: '400',
      })
    ).toBe(true);
  });
  it('resolves nested own properties without prototype traversal', () => {
    expect(conditionPath({ address: { city: 'Mumbai' } }, 'address.city')).toBe(
      'Mumbai'
    );
    expect(conditionPath({}, '__proto__.toString')).toBeUndefined();
    expect(conditionPath({}, 'constructor')).toBeUndefined();
  });
});

describe('Shopify condition data', () => {
  const order = {
    id: '100',
    total_price: '2000.50',
    currency: 'INR',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    created_at: '2026-10-13T00:00:00Z',
    tags: 'VIP, COD-confirmed',
    line_items: [
      { product_id: '1', variant_id: '2', sku: 'SKU-A', quantity: 2 },
      { product_id: '1', variant_id: '3', sku: 'SKU-B', quantity: 3 },
    ],
    shipping_address: { city: 'Mumbai', zip: '400001' },
  };
  it('retains numeric amounts, IDs, quantities, tags and nested delivery data', () => {
    const data = shopifyConditionData(order, 'order');
    expect(data).toMatchObject({
      total: 2000.5,
      quantity: 5,
      product_ids: ['1', '1'],
      tags: ['VIP', 'COD-confirmed'],
      fulfillment_status: 'unfulfilled',
    });
    expect(
      resolveShopifyConditionValue(
        data,
        rule({ subject_key: 'shipping_address.zip' })
      )
    ).toBe('400001');
    expect(
      resolveShopifyConditionValue(
        data,
        rule({
          subject_key: 'item_quantity',
          item_key: 'product_id',
          item_value: '1',
        })
      )
    ).toBe(5);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({
          subject_key: 'item_quantity',
          item_key: 'sku',
          item_value: 'SKU-A',
        })
      )
    ).toBe(2);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({ subject_key: 'age_hours' }),
        Date.parse('2026-10-14T00:00:00Z')
      )
    ).toBe(24);
  });

  it('matches product names ignoring case and counts by name or collection', () => {
    const data = shopifyConditionData(
      {
        ...order,
        line_items: [
          { product_id: '1', title: 'Baby Romper', quantity: 2 },
          { product_id: '7', title: 'Bib Set', quantity: 1 },
        ],
      },
      'order'
    );
    const names = rule({
      subject_key: 'product_names',
      operator: 'contains',
      value: 'baby romper ',
    });
    const value = resolveShopifyConditionValue(data, names);
    expect(value).toEqual(['baby romper', 'Bib Set']);
    expect(
      compareCondition({
        operator: 'contains',
        subjectValue: value,
        configValue: 'baby romper',
      })
    ).toBe(true);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({
          subject_key: 'item_quantity',
          item_key: 'title',
          item_value: 'BABY ROMPER',
        })
      )
    ).toBe(2);
    const collections = new Map([
      ['55', new Set(['7'])],
      ['66', new Set<string>()],
    ]);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({
          subject_key: 'collection_ids',
          operator: 'contains_any',
          value: '55, 66',
        }),
        Date.now(),
        collections
      )
    ).toEqual(['55']);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({
          subject_key: 'item_quantity',
          item_key: 'collection_id',
          item_value: '55',
        }),
        Date.now(),
        collections
      )
    ).toBe(1);
    // Without a Shopify lookup the value is unknown, never an empty match.
    expect(
      resolveShopifyConditionValue(
        data,
        rule({ subject_key: 'collection_ids', value: '55' })
      )
    ).toBeUndefined();
  });

  it('validates collection and name rules', () => {
    expect(
      validateConditionPredicate(
        rule({
          subject_key: 'collection_ids',
          operator: 'present',
          value: '',
        })
      )
    ).toContain('Operator is not supported for this field type.');
    expect(
      validateConditionPredicate(
        rule({
          subject_key: 'collection_ids',
          operator: 'contains',
          value: 'Summer',
        })
      )
    ).toContain('Pick collections from the list (numeric collection IDs).');
    expect(
      validateConditionPredicate(
        rule({
          subject_key: 'item_quantity',
          operator: 'gte',
          value: '1',
          item_key: 'title',
          item_value: 'Baby Romper',
        })
      )
    ).toEqual([]);
  });
  it('does not infer COD from pending payment; supports configured gateway names', () => {
    const data = shopifyConditionData(
      { ...order, payment_gateway_names: ['Bank Transfer'] },
      'order'
    );
    expect(
      resolveShopifyConditionValue(data, rule({ subject_key: 'is_cod' }))
    ).toBe(false);
    expect(
      resolveShopifyConditionValue(
        data,
        rule({ subject_key: 'is_cod', cod_gateways: 'bank transfer' })
      )
    ).toBe(true);
    expect(
      resolveShopifyConditionValue({}, rule({ subject_key: 'is_cod' }))
    ).toBeUndefined();
  });
  it('keeps the order ID on fulfillment events and preserves order fulfillment state', () => {
    const ctx = contextFromFulfillment(
      {
        id: '900',
        order_id: '100',
        status: 'success',
        shipment_status: 'delivered',
        tracking_number: 'TRACK',
      },
      { ...order, fulfillment_status: 'partial' },
      'Store'
    );
    expect(ctx.shopifyOrderId).toBe('100');
    expect(ctx.conditionData).toMatchObject({
      resource_id: '100',
      fulfillment_status: 'partial',
      shipment_status: ['delivered'],
      tracking_numbers: ['TRACK'],
    });
    expect(contextFromOrder(order, 'Store').conditionData?.total).toBe(2000.5);
  });
});

describe('activation validation', () => {
  it('rejects malformed types, ranges, unsupported status and operators', () => {
    expect(
      validateConditionPredicate(rule({ value: 'INR 2,000' }))
    ).not.toEqual([]);
    expect(
      validateConditionPredicate(
        rule({ operator: 'between', value: '5', value_to: '2' })
      )
    ).not.toEqual([]);
    expect(
      validateConditionPredicate(
        rule({
          subject_key: 'payment_status',
          operator: 'equals',
          value: 'made-up',
        })
      )
    ).not.toEqual([]);
    expect(
      validateConditionPredicate(
        rule({ subject_key: 'tags', operator: 'gte', value: '2' })
      )
    ).not.toEqual([]);
    expect(
      validateConditionPredicate(
        rule({
          subject_key: 'payment_status',
          operator: 'equals',
          value: 'refunded',
        })
      )
    ).toEqual([]);
  });
  it('offers only applicable fields for checkout triggers', () => {
    const keys = shopifyConditionFields('shopify_checkout').map((f) => f.key);
    expect(keys).toContain('total');
    expect(keys).not.toContain('payment_status');
    expect(keys).not.toContain('is_cod');
  });
  it('validates group rules, match mode and resource compatibility', () => {
    const flow = {
      name: 'Order conditions',
      trigger_type: 'shopify_order_placed' as const,
      trigger_config: {},
      entry_node_id: 'condition',
    };
    const nodes = (config: Record<string, unknown>) => [
      {
        node_key: 'condition',
        node_type: 'condition',
        config: { true_next: 'end', false_next: 'end', ...config },
      },
      { node_key: 'end', node_type: 'end', config: {} },
    ];
    expect(
      validateFlowForActivation(
        flow,
        nodes({ rules: [rule()], match: 'all' })
      ).filter((i) => i.severity === 'error')
    ).toEqual([]);
    expect(
      validateFlowForActivation(flow, nodes({ rules: [], match: 'all' })).some(
        (i) => i.severity === 'error'
      )
    ).toBe(true);
    expect(
      validateFlowForActivation(
        flow,
        nodes({ rules: [null], match: 'all' })
      ).some((i) => i.severity === 'error')
    ).toBe(true);
    expect(
      validateFlowForActivation(
        flow,
        nodes({ rules: [rule({ subject: 'shopify_checkout' })], match: 'all' })
      ).some((i) => i.message.includes('trigger'))
    ).toBe(true);
    expect(
      validateFlowForActivation(
        flow,
        nodes({ ...rule(), value: { bad: true } })
      ).some((i) => i.message.includes('text values'))
    ).toBe(true);
  });
});
