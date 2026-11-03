import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConditionNodeConfig,
  ConditionPredicate,
  FlowRunRow,
} from './types';
import { createConditionEvaluator } from './condition-runtime';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'decrypted-token'),
}));
vi.mock('@/lib/shopify/admin-api', () => ({
  fetchOrder: vi.fn(),
  fetchConditionOrderCount: vi.fn(),
  fetchProductCollectionMembership: vi.fn(),
}));
import {
  fetchOrder,
  fetchConditionOrderCount,
  fetchProductCollectionMembership,
} from '@/lib/shopify/admin-api';

const predicate = (
  patch: Partial<ConditionPredicate> = {}
): ConditionPredicate => ({
  subject: 'shopify_order',
  subject_key: 'payment_status',
  operator: 'equals',
  value: 'pending',
  ...patch,
});
const group = (rules: ConditionPredicate[], match: 'all' | 'any' = 'all') =>
  ({
    ...predicate(),
    rules,
    match,
    true_next: 'yes',
    false_next: 'no',
  }) satisfies ConditionNodeConfig;
const run = {
  id: 'run',
  account_id: 'account-A',
  contact_id: 'contact-A',
  vars: {
    shopify_order_id: '123',
    shopify_condition_data: {
      resource_type: 'order',
      resource_id: '123',
      customer_id: '99',
      payment_status: 'pending',
      total: 2000,
      created_at: '2026-10-13T00:00:00Z',
    },
  },
} as unknown as FlowRunRow;
function mockDb(
  config: unknown = {
    shop_domain: 'test.myshopify.com',
    access_token: 'encrypted',
    status: 'connected',
  }
) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: config, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return {
    db: { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient,
    chain,
  };
}
beforeEach(() => vi.resetAllMocks());

describe('condition execution', () => {
  it('keeps contains and not_contains inverse for captured list variables', async () => {
    const { db } = mockDb();
    const evaluator = createConditionEvaluator(db, {
      ...run,
      vars: { ...run.vars, products: ['Personalized Baby Birth Frame'] },
    } as unknown as FlowRunRow);
    for (const [operator, expected] of [
      ['contains', true],
      ['not_contains', false],
    ] as const) {
      expect(
        await evaluator.group(
          group([
            predicate({
              subject: 'var',
              subject_key: 'products',
              operator,
              value: 'baby birth',
            }),
          ])
        )
      ).toBe(expected);
    }
  });

  it('checks presence without treating false or zero as missing', async () => {
    const { db } = mockDb();
    for (const [value, present] of [
      [undefined, false],
      [null, false],
      ['  ', false],
      [[], false],
      [[null, ''], false],
      [false, true],
      [0, true],
    ] as const) {
      const evaluator = createConditionEvaluator(db, {
        ...run,
        vars: { ...run.vars, answer: value },
      } as unknown as FlowRunRow);
      for (const operator of ['present', 'absent'] as const) {
        expect(
          await evaluator.group(
            group([
              predicate({
                subject: 'var',
                subject_key: 'answer',
                operator,
              }),
            ])
          )
        ).toBe(operator === 'present' ? present : !present);
      }
    }
  });

  it.each(['shopify_order', 'shopify_checkout'] as const)(
    'matches partial product titles for %s without making IDs or tags partial',
    async (subject) => {
      const { db } = mockDb();
      const evaluator = createConditionEvaluator(db, {
        ...run,
        vars: {
          ...run.vars,
          shopify_condition_data: {
            resource_type: subject === 'shopify_order' ? 'order' : 'checkout',
            line_items: [
              { title: 'Personalized Baby Birth Frame', product_id: '12345' },
              { name: 'Engraved Gift Box - Large' },
            ],
            product_ids: ['12345'],
            tags: ['VIP-new'],
          },
        },
      } as unknown as FlowRunRow);
      const cases: Array<[Partial<ConditionPredicate>, boolean]> = [
        [{ operator: 'contains', value: 'baby birth' }, true],
        [{ operator: 'equals', value: 'baby birth' }, false],
        [{ operator: 'equals', value: 'personalized baby birth frame' }, true],
        [{ operator: 'not_equals', value: 'baby birth' }, true],
        [
          { operator: 'not_equals', value: 'Personalized Baby Birth Frame' },
          false,
        ],
        [{ operator: 'contains', value: 'BABY BIRTH' }, true],
        [
          { operator: 'contains', value: 'Personalized Baby Birth Frame' },
          true,
        ],
        [{ operator: 'contains', value: 'gift box' }, true],
        [{ operator: 'contains', value: 'wedding' }, false],
        [{ operator: 'not_contains', value: 'baby birth' }, false],
        [{ operator: 'not_contains', value: 'wedding' }, true],
        [{ operator: 'contains_any', value: 'wedding, baby birth' }, true],
        [{ operator: 'contains_all', value: 'baby birth, gift box' }, true],
        [{ operator: 'contains_all', value: 'baby birth, wedding' }, false],
        [
          { subject_key: 'product_ids', operator: 'contains', value: '123' },
          false,
        ],
        [{ subject_key: 'tags', operator: 'contains', value: 'VIP' }, false],
      ];
      for (const [patch, expected] of cases) {
        expect(
          await evaluator.group(
            group([
              predicate({
                subject,
                subject_key: 'product_names',
                ...patch,
              }),
            ])
          )
        ).toBe(expected);
      }
      expect(db.from).not.toHaveBeenCalled();
    }
  );

  it('looks up collections for the triggering products once per node', async () => {
    const { db } = mockDb();
    vi.mocked(fetchProductCollectionMembership).mockResolvedValue(
      new Map([['55', new Set(['1'])]])
    );
    const withItems = {
      ...run,
      vars: {
        ...run.vars,
        shopify_condition_data: {
          ...(run.vars.shopify_condition_data as object),
          product_ids: ['1', '2'],
          line_items: [
            { product_id: '1', quantity: 3 },
            { product_id: '2', quantity: 1 },
          ],
        },
      },
    } as unknown as FlowRunRow;
    const evaluator = createConditionEvaluator(db, withItems);
    expect(
      await evaluator.group(
        group([
          predicate({
            subject_key: 'collection_ids',
            operator: 'contains',
            value: '55',
          }),
          predicate({
            subject_key: 'item_quantity',
            operator: 'gte',
            value: '3',
            item_key: 'collection_id',
            item_value: '55',
          }),
        ])
      )
    ).toBe(true);
    expect(fetchProductCollectionMembership).toHaveBeenCalledExactlyOnceWith(
      'test.myshopify.com',
      'decrypted-token',
      ['1', '2'],
      ['55']
    );
    expect(evaluator.traces.map((t) => t.source)).toEqual([
      'latest_collections',
      'latest_collections',
    ]);
  });
  it('evaluates ALL and ANY groups with short-circuiting', async () => {
    const { db } = mockDb();
    expect(
      await createConditionEvaluator(db, run).group(
        group([
          predicate(),
          predicate({ subject_key: 'total', operator: 'gte', value: '1500' }),
        ])
      )
    ).toBe(true);
    const evaluator = createConditionEvaluator(db, run);
    expect(
      await evaluator.group(
        group([predicate({ value: 'paid' }), predicate()], 'any')
      )
    ).toBe(true);
    expect(evaluator.traces).toHaveLength(2);
    const short = createConditionEvaluator(db, run);
    expect(
      await short.group(
        group([
          predicate({ value: 'paid' }),
          predicate({ data_source: 'latest' }),
        ])
      )
    ).toBe(false);
    expect(fetchOrder).not.toHaveBeenCalled();
  });
  it('fetches the triggering order once per node and scopes credentials by account', async () => {
    const { db, chain } = mockDb();
    vi.mocked(fetchOrder).mockResolvedValue({
      id: '123',
      financial_status: 'paid',
      total_price: '3500',
      currency: 'INR',
    });
    const evaluator = createConditionEvaluator(db, run);
    expect(
      await evaluator.group(
        group([
          predicate({ data_source: 'latest', value: 'paid' }),
          predicate({
            data_source: 'latest',
            subject_key: 'total',
            operator: 'gte',
            value: '3000',
          }),
        ])
      )
    ).toBe(true);
    expect(fetchOrder).toHaveBeenCalledExactlyOnceWith(
      'test.myshopify.com',
      'decrypted-token',
      '123'
    );
    expect(chain.eq).toHaveBeenCalledWith('account_id', 'account-A');
    expect(evaluator.traces.every((t) => t.source === 'latest')).toBe(true);
  });
  it('does not reuse stale order state after a wait / new evaluation scope', async () => {
    const { db } = mockDb();
    vi.mocked(fetchOrder)
      .mockResolvedValueOnce({ id: '123', financial_status: 'pending' })
      .mockResolvedValueOnce({ id: '123', financial_status: 'paid' });
    const cfg = group([predicate({ data_source: 'latest' })]);
    expect(await createConditionEvaluator(db, run).group(cfg)).toBe(true);
    expect(await createConditionEvaluator(db, run).group(cfg)).toBe(false);
    expect(fetchOrder).toHaveBeenCalledTimes(2);
  });
  it('fails lookup errors without falling back to the snapshot', async () => {
    const { db } = mockDb();
    vi.mocked(fetchOrder).mockRejectedValue(new Error('Shopify unavailable'));
    await expect(
      createConditionEvaluator(db, run).group(
        group([predicate({ data_source: 'latest' })])
      )
    ).rejects.toThrow('Shopify unavailable');
    await expect(
      createConditionEvaluator(db, {
        ...run,
        vars: { ...run.vars, shopify_order_id: undefined },
      }).group(group([predicate({ data_source: 'latest' })]))
    ).rejects.toThrow('ID');
  });
  it('logs missing Shopify values and does not pass negative comparisons', async () => {
    const { db } = mockDb();
    const evaluator = createConditionEvaluator(db, run);
    expect(
      await evaluator.group(
        group([
          predicate({
            subject_key: 'currency',
            operator: 'not_equals',
            value: 'INR',
          }),
        ])
      )
    ).toBe(false);
    expect(evaluator.traces[0]).toMatchObject({ missing: true, result: false });
    expect(
      await evaluator.group(
        group([predicate({ subject_key: 'currency', operator: 'absent' })])
      )
    ).toBe(true);
  });
  it('uses Shopify history and caches count lookups across rules', async () => {
    const { db } = mockDb();
    vi.mocked(fetchConditionOrderCount).mockResolvedValue(2);
    expect(
      await createConditionEvaluator(db, run).group(
        group([
          predicate({ subject_key: 'is_repeat_customer', value: 'true' }),
          predicate({
            subject_key: 'previous_order_count',
            operator: 'gte',
            value: '2',
          }),
        ])
      )
    ).toBe(true);
    expect(fetchConditionOrderCount).toHaveBeenCalledExactlyOnceWith(
      'test.myshopify.com',
      'decrypted-token',
      '99',
      '2026-10-12T23:59:59.999Z'
    );
  });
  it('fails when history or the correct resource snapshot is unavailable', async () => {
    const { db } = mockDb();
    await expect(
      createConditionEvaluator(db, { ...run, vars: {} }).group(
        group([predicate()])
      )
    ).rejects.toThrow('snapshot');
    await expect(
      createConditionEvaluator(db, run).group(
        group([
          predicate({ subject: 'shopify_checkout', subject_key: 'total' }),
        ])
      )
    ).rejects.toThrow('checkout snapshot');
    vi.mocked(fetchConditionOrderCount).mockRejectedValue(
      new Error('Complete customer history is unavailable')
    );
    await expect(
      createConditionEvaluator(db, run).group(
        group([predicate({ subject_key: 'previous_order_count' })])
      )
    ).rejects.toThrow('history');
  });
  it('preserves legacy payment status and nested captured variables', async () => {
    const { db } = mockDb();
    const vars = { payment_status: 'pending', address: { city: 'Mumbai' } };
    const evaluator = createConditionEvaluator(db, { ...run, vars });
    expect(
      await evaluator.group(
        group([
          predicate({ subject: 'shopify_payment' }),
          predicate({
            subject: 'var',
            subject_key: 'address.city',
            value: 'Mumbai',
          }),
        ])
      )
    ).toBe(true);
  });

  it('preserves comma-joined array comparisons in legacy variable conditions', async () => {
    const { db } = mockDb();
    const evaluator = createConditionEvaluator(db, {
      ...run,
      vars: { items: ['one', 'two'] },
    });
    expect(
      await evaluator.group(
        group([
          predicate({
            subject: 'var',
            subject_key: 'items',
            operator: 'equals',
            value: 'one,two',
          }),
        ])
      )
    ).toBe(true);
  });
});
