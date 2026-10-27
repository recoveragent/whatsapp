import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowRunRow } from '@/lib/flows/types';

const api = vi.hoisted(() => ({ state: vi.fn(), mark: vi.fn() }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
vi.mock('./admin-api', () => ({
  fetchOrderPaymentState: api.state,
  markOrderAsPaid: api.mark,
}));
import {
  prepareRecoveryOrder,
  confirmRecoveryCod,
  completeRecoveryOrder,
  recoverySummary,
  RECOVERY_SUMMARY_MAX,
} from './recovery-orders';

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>) {
  let sequence = 0;
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | undefined;
      let insert: Row | undefined;
      let remove = false;
      const execute = () => {
        const rows = (tables[table] ??= []);
        if (insert) {
          if (
            table === 'shopify_checkout_recoveries' &&
            rows.some(
              (r) =>
                r.account_id === insert!.account_id &&
                r.checkout_id === insert!.checkout_id
            )
          )
            return { data: [], error: { code: '23505' } };
          rows.push({
            id: `recovery-${++sequence}`,
            payment_request_id: null,
            shopify_order_id: null,
            draft_order_id: null,
            ...insert,
          });
          insert = undefined;
        }
        const selected = rows.filter((r) => filters.every((f) => f(r)));
        if (patch) selected.forEach((r) => Object.assign(r, patch));
        if (remove)
          tables[table] = rows.filter((r) => !selected.includes(r));
        return { data: structuredClone(selected), error: null };
      };
      const b = {
        select: () => b,
        eq: (key: string, value: unknown) => {
          filters.push((r) => r[key] === value);
          return b;
        },
        is: (key: string, value: unknown) => {
          filters.push((r) => (r[key] ?? null) === value);
          return b;
        },
        insert: (value: Row) => {
          insert = value;
          return b;
        },
        update: (value: Row) => {
          patch = value;
          return b;
        },
        delete: () => {
          remove = true;
          return b;
        },
        single: async () => {
          const r = execute();
          return { ...r, data: r.data[0] ?? null };
        },
        maybeSingle: async () => {
          const r = execute();
          return { ...r, data: r.data[0] ?? null };
        },
        then: (resolve: (v: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(resolve(execute())),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function fixture() {
  const run = {
    id: 'run-1',
    account_id: 'brand-1',
    contact_id: 'contact-1',
    vars: { checkout_id: 'checkout-1', order_items: 'Shirt × 2' },
  } as unknown as FlowRunRow;
  const tables: Record<string, Row[]> = {
    contacts: [
      { id: 'contact-1', account_id: 'brand-1', phone: '+919876543210' },
    ],
    shopify_config: [
      {
        account_id: 'brand-1',
        status: 'connected',
        shop_domain: 'test.myshopify.com',
        access_token: 'test-token',
      },
    ],
    shopify_pending_checkouts: [
      {
        account_id: 'brand-1',
        checkout_id: 'checkout-1',
        contact_id: 'contact-1',
        status: 'sent',
        created_at: new Date(Date.now() - 3600000).toISOString(),
        payload: {
          currency: 'INR',
          total_price: '250.00',
          phone: '+919876543210',
          line_items: [{ variant_id: 1234, quantity: 2 }],
          shipping_lines: [{ price: '50.00' }],
          shipping_address: {
            first_name: 'Test',
            address1: '12 Test Road',
            city: 'Bengaluru',
            province: 'Karnataka',
            zip: '560001',
            country_code: 'IN',
          },
        },
      },
    ],
    shopify_checkout_recoveries: [],
    flow_payment_requests: [],
    flow_runs: [run as unknown as Row],
  };
  let order: Row | null = null;
  let total = '250.00';
  let stock = 20;
  let recentOrders: Row[] = [];
  let terms = true;
  let draftResult: 'ok' | 'rejected' | 'lost' = 'ok';
  const draft = () => ({
    id: 'gid://shopify/DraftOrder/1',
    totalPriceSet: { shopMoney: { amount: total, currencyCode: 'INR' } },
    order,
    lineItems: {
      nodes: [
        {
          title: 'Shirt',
          quantity: 2,
          variant: { id: 'gid://shopify/ProductVariant/1234' },
        },
      ],
    },
    shippingAddress: {
      firstName: 'Test',
      lastName: '',
      address1: '12 Test Road',
      address2: '',
      city: 'Bengaluru',
      province: 'Karnataka',
      zip: '560001',
      countryCodeV2: 'IN',
      phone: '+919876543210',
    },
  });
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const { query } = JSON.parse(String(options.body));
    let data: Row;
    if (query.includes('RecoveryRecentOrders'))
      data = {
        orders: { nodes: recentOrders, pageInfo: { hasNextPage: false } },
      };
    else if (query.includes('RecoveryCustomerCreate'))
      data = {
        customerCreate: {
          customer: { id: 'gid://shopify/Customer/1' },
          userErrors: [],
        },
      };
    else if (query.includes('RecoveryCustomer'))
      data = {
        customers: {
          nodes: [
            {
              id: 'gid://shopify/Customer/1',
              defaultPhoneNumber: { phoneNumber: '+919876543210' },
            },
          ],
        },
      };
    else if (query.includes('RecoveryPaymentTerms'))
      data = {
        paymentTermsTemplates: terms
          ? [{ id: 'gid://shopify/PaymentTermsTemplate/9' }]
          : [],
      };
    else if (query.includes('RecoveryInventory'))
      data = {
        nodes: [
          {
            id: 'gid://shopify/ProductVariant/1234',
            inventoryQuantity: stock,
            inventoryPolicy: 'DENY',
            inventoryItem: { tracked: true },
            product: { status: 'ACTIVE' },
          },
        ],
      };
    else if (query.includes('mutation RecoveryDraft')) {
      if (draftResult === 'lost') return new Response('', { status: 502 });
      data = {
        draftOrderCreate:
          draftResult === 'rejected'
            ? { draftOrder: null, userErrors: [{ message: 'Invalid address' }] }
            : { draftOrder: draft(), userErrors: [] },
      };
    }
    else if (query.includes('ReserveRecoveryDraft'))
      data = { draftOrderUpdate: { draftOrder: draft(), userErrors: [] } };
    else if (query.includes('CompleteRecoveryDraft')) {
      order = { id: 'gid://shopify/Order/99', name: '#1099' };
      data = { draftOrderComplete: { draftOrder: draft(), userErrors: [] } };
    } else data = { draftOrder: draft() };
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return {
    db: database(tables),
    tables,
    run,
    fetch,
    setTotal: (v: string) => {
      total = v;
    },
    setStock: (v: number) => {
      stock = v;
    },
    setRecentOrders: (v: Row[]) => {
      recentOrders = v;
    },
    setTerms: (v: boolean) => {
      terms = v;
    },
    setDraftResult: (v: typeof draftResult) => {
      draftResult = v;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.state.mockResolvedValue({
    outstanding: '250.00',
    currency: 'INR',
    cancelled: false,
    canMarkAsPaid: true,
  });
  api.mark.mockResolvedValue(undefined);
});

describe('Shopify recovery order lifecycle', () => {
  it('quotes the saved checkout, reserves inventory and reuses the same draft', async () => {
    const f = fixture();
    const first = await prepareRecoveryOrder(f.db, f.run);
    const again = await prepareRecoveryOrder(f.db, f.run);
    expect(again.id).toBe(first.id);
    expect(first.summary).toContain('INR 250.00');
    expect(
      f.fetch.mock.calls.filter(([, o]) =>
        JSON.parse(String(o.body)).query.includes('mutation RecoveryDraft')
      )
    ).toHaveLength(1);
  });
  it('does not create a draft when inventory is unavailable', async () => {
    const f = fixture();
    f.setStock(0);
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'unavailable'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
  });
  it('does not accept a different Shopify total or retry an ambiguous draft create', async () => {
    const f = fixture();
    f.setTotal('270.00');
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow('differs');
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'in progress'
    );
  });
  it('frees the checkout when Shopify definitely created no draft', async () => {
    const f = fixture();
    f.setTerms(false);
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'payment terms'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
    f.setTerms(true);
    f.setDraftResult('rejected');
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'Invalid address'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
    f.setDraftResult('ok');
    await expect(prepareRecoveryOrder(f.db, f.run)).resolves.toMatchObject({
      status: 'quoted',
    });
  });
  it('keeps the claim when the draft create response is lost', async () => {
    const f = fixture();
    f.setDraftResult('lost');
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow('502');
    expect(f.tables.shopify_checkout_recoveries).toMatchObject([
      { status: 'preparing', draft_order_id: null },
    ]);
    f.setDraftResult('ok');
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'in progress'
    );
  });
  it('keeps the COD summary within the WhatsApp message limit', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({
      title: `Handwoven cotton kurta with mirror work, size ${i}`.repeat(2),
      quantity: 1,
      variant: null,
    }));
    const summary = recoverySummary(
      {
        lineItems: { nodes },
        shippingAddress: {
          firstName: 'Test',
          lastName: 'Customer',
          address1: 'Flat 12, '.repeat(60),
          address2: null,
          city: 'Bengaluru',
          province: 'Karnataka',
          zip: '560001',
          countryCodeV2: 'IN',
          phone: null,
        },
      },
      129900
    );
    expect(summary.length).toBeLessThanOrEqual(RECOVERY_SUMMARY_MAX);
    expect(summary).toMatch(/\+ \d+ more items/);
    expect(summary).toContain('Total: INR 1299.00');
    expect(summary).toContain('Deliver to: Test, Customer');
  });
  it('blocks a customer who already placed an order after checkout', async () => {
    const f = fixture();
    f.setRecentOrders([
      { phone: '+919876543210', cancelledAt: null, shippingAddress: null },
    ]);
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'already placed'
    );
  });
  it('requires server-recorded COD confirmation and creates one order on retries', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run);
    await expect(
      completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run })
    ).rejects.toThrow('confirmation');
    f.run.vars = {
      ...f.run.vars,
      checkout_recovery_id: r.id,
      checkout_order_summary: r.summary,
    };
    await confirmRecoveryCod(f.db, f.run);
    expect(
      (await completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run }))
        .order_name
    ).toBe('#1099');
    expect(
      (await completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run }))
        .shopify_order_id
    ).toBe('99');
    expect(
      f.fetch.mock.calls.filter(([, o]) =>
        JSON.parse(String(o.body)).query.includes('CompleteRecoveryDraft')
      )
    ).toHaveLength(1);
    expect(api.mark).not.toHaveBeenCalled();
  });
  it('does not accept confirmation for another customer or a changed summary', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run);
    f.run.vars.checkout_recovery_id = r.id;
    f.run.vars.checkout_order_summary = 'Not the displayed quote';
    await expect(confirmRecoveryCod(f.db, f.run)).rejects.toThrow('Review');
    f.run.contact_id = 'other-customer';
    await expect(prepareRecoveryOrder(f.db, f.run)).rejects.toThrow(
      'another customer'
    );
  });
  it('creates a paid order only for the exact verified checkout payment', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run);
    f.tables.shopify_checkout_recoveries[0].payment_request_id = 'payment-1';
    f.tables.flow_payment_requests.push({
      id: 'payment-1',
      account_id: 'brand-1',
      checkout_recovery_id: r.id,
      flow_run_id: f.run.id,
      status: 'pending',
      amount_paise: 25000,
    });
    await expect(
      completeRecoveryOrder(f.db, r.id, 'brand-1', {
        paymentRequestId: 'payment-1',
      })
    ).rejects.toThrow('Verified payment');
    f.tables.flow_payment_requests[0].status = 'paid';
    const placed = await completeRecoveryOrder(f.db, r.id, 'brand-1', {
      paymentRequestId: 'payment-1',
    });
    expect(placed.shopify_order_id).toBe('99');
    expect(api.mark).toHaveBeenCalledWith(
      'test.myshopify.com',
      'test-token',
      '99'
    );
  });
  it('does not place COD while an online payment request exists', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run);
    f.run.vars = {
      ...f.run.vars,
      checkout_recovery_id: r.id,
      checkout_order_summary: r.summary,
    };
    await confirmRecoveryCod(f.db, f.run);
    f.tables.shopify_checkout_recoveries[0].payment_request_id = 'payment-1';
    await expect(
      completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run })
    ).rejects.toThrow('payment request');
  });
  it('rejects an expired COD quote after confirmation', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run);
    f.run.vars = {
      ...f.run.vars,
      checkout_recovery_id: r.id,
      checkout_order_summary: r.summary,
    };
    await confirmRecoveryCod(f.db, f.run);
    f.tables.shopify_checkout_recoveries[0].quoted_at = new Date(
      Date.now() - 16 * 60_000
    ).toISOString();
    await expect(
      completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run })
    ).rejects.toThrow('quote expired');
  });
});
