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
  let total: string | null = null;
  let shipping = 50;
  let lines: Row[] = [{ quantity: 2, variantId: 'gid://shopify/ProductVariant/1234' }];
  let stock = 20;
  let recentOrders: Row[] = [];
  let terms = true;
  let customers: Row[] = [
    {
      id: 'gid://shopify/Customer/1',
      defaultPhoneNumber: { phoneNumber: '+919876543210' },
      defaultEmailAddress: null,
    },
  ];
  let createResult: Row = {
    customer: { id: 'gid://shopify/Customer/1' },
    userErrors: [],
  };
  /** Customers Shopify search returns after a create attempt (indexing delay). */
  let afterCreate: Row[] | null = null;
  let draftResult: 'ok' | 'rejected' | 'lost' = 'ok';
  const draft = () => ({
    id: 'gid://shopify/DraftOrder/1',
    // Items cost 200; Shopify adds the draft's shipping line.
    totalPriceSet: {
      shopMoney: { amount: total ?? (200 + shipping).toFixed(2), currencyCode: 'INR' },
    },
    order,
    lineItems: {
      nodes: lines.map((line) => ({
        title: 'Shirt',
        quantity: line.quantity,
        variant: { id: line.variantId },
        customAttributes: line.customAttributes ?? [],
      })),
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
    const { query, variables } = JSON.parse(String(options.body));
    const input = variables?.input ?? {};
    if (input.shippingLine)
      shipping = Number(input.shippingLine.priceWithCurrency.amount);
    if (input.lineItems) lines = input.lineItems;
    let data: Row;
    if (query.includes('RecoveryRecentOrders'))
      data = {
        orders: { nodes: recentOrders, pageInfo: { hasNextPage: false } },
      };
    else if (query.includes('RecoveryCustomerCreate')) {
      data = { customerCreate: createResult };
      if (afterCreate) customers = afterCreate;
    } else if (query.includes('RecoveryCustomer'))
      data = { customers: { nodes: customers } };
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
    setCustomers: (v: Row[], create?: Row, after?: Row[]) => {
      customers = v;
      if (create) createResult = create;
      afterCreate = after ?? null;
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

/** Turns the fixture's saved checkout into a Recover Agent mirror with partner totals. */
function mirror(f: ReturnType<typeof fixture>, flat: Row) {
  const saved = f.tables.shopify_pending_checkouts[0];
  saved.payload = {
    _wa_recover_agent_mirror: true,
    event: { amount: 250, phone: '+919876543210', flat, raw: saved.payload },
  };
}

const bodies = (f: ReturnType<typeof fixture>) =>
  f.fetch.mock.calls.map(([, o]) => JSON.parse(String(o.body)));

describe('Shopify recovery order lifecycle', () => {
  it('quotes the saved checkout, reserves inventory and reuses the same draft', async () => {
    const f = fixture();
    const first = await prepareRecoveryOrder(f.db, f.run, 'cod');
    const again = await prepareRecoveryOrder(f.db, f.run, 'cod');
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
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'unavailable'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
  });
  it('does not accept a different Shopify total or retry an ambiguous draft create', async () => {
    const f = fixture();
    f.setTotal('270.00');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow('differs');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'in progress'
    );
  });
  it('frees the checkout when Shopify definitely created no draft', async () => {
    const f = fixture();
    f.setTerms(false);
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'payment terms'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
    f.setTerms(true);
    f.setDraftResult('rejected');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'Invalid address'
    );
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
    f.setDraftResult('ok');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).resolves.toMatchObject({
      status: 'quoted',
    });
  });
  it('keeps the claim when the draft create response is lost', async () => {
    const f = fixture();
    f.setDraftResult('lost');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow('502');
    expect(f.tables.shopify_checkout_recoveries).toMatchObject([
      { status: 'preparing', draft_order_id: null },
    ]);
    f.setDraftResult('ok');
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
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
  it('quotes COD with the checkout partner charge and re-prices the same draft for UPI', async () => {
    const f = fixture();
    mirror(f, { cash_on_delivery_total_amount: 300 });
    const cod = await prepareRecoveryOrder(f.db, f.run, 'cod');
    expect(cod.amount_paise).toBe(30000);
    expect(cod.summary).toContain(
      'Total: INR 300.00 (includes INR 50.00 COD charges)'
    );
    const create = bodies(f).find((b) => b.query.includes('mutation RecoveryDraft'));
    expect(create.variables.input.shippingLine).toEqual({
      title: 'Standard (COD)',
      priceWithCurrency: { amount: '100.00', currencyCode: 'INR' },
    });
    // A COD confirmation must not survive a change of price.
    f.tables.shopify_checkout_recoveries[0].confirmed_at = new Date().toISOString();
    f.tables.shopify_checkout_recoveries[0].confirmed_flow_run_id = f.run.id;
    const prepaid = await prepareRecoveryOrder(f.db, f.run, 'prepaid');
    expect(prepaid).toMatchObject({
      id: cod.id,
      amount_paise: 25000,
      confirmed_at: null,
      confirmed_flow_run_id: null,
    });
    expect(prepaid.summary).toContain('Total: INR 250.00');
    expect(prepaid.summary).not.toContain('COD charges');
    expect(
      bodies(f).filter((b) => b.query.includes('mutation RecoveryDraft'))
    ).toHaveLength(1);
    const repriced = bodies(f).find(
      (b) => b.query.includes('ReserveRecoveryDraft') && b.variables.input.shippingLine
    );
    expect(repriced.variables.input.shippingLine).toEqual({
      title: 'Standard (Prepaid)',
      priceWithCurrency: { amount: '50.00', currencyCode: 'INR' },
    });
  });
  it('carries personalization onto the order and shows only readable details to the customer', async () => {
    const f = fixture();
    const attributes = [
      { key: 'Engraving', value: 'Asha' },
      { key: '_design', value: 'd-1' },
      { key: 'Photo', value: 'https://cdn.example.com/p.jpg' },
    ];
    (f.tables.shopify_pending_checkouts[0].payload as Row).line_items = [
      {
        variant_id: 1234,
        quantity: 2,
        properties: attributes.map(({ key, value }) => ({ name: key, value })),
      },
    ];
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
    const create = bodies(f).find((b) => b.query.includes('mutation RecoveryDraft'));
    expect(create.variables.input.lineItems[0].customAttributes).toEqual(attributes);
    expect(r.summary).toContain('Shirt × 2 (Engraving: Asha)');
    expect(r.summary).not.toContain('d-1');
    expect(r.summary).not.toContain('cdn.example.com');
  });
  it('refuses a confirmed COD order when the COD price changed after review', async () => {
    const f = fixture();
    mirror(f, { cash_on_delivery_total_amount: 300 });
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
    f.run.vars = {
      ...f.run.vars,
      checkout_recovery_id: r.id,
      checkout_order_summary: r.summary,
    };
    await confirmRecoveryCod(f.db, f.run);
    const saved = f.tables.shopify_pending_checkouts[0].payload as {
      event: { flat: Row };
    };
    saved.event.flat.cash_on_delivery_total_amount = 320;
    await expect(
      completeRecoveryOrder(f.db, r.id, 'brand-1', { run: f.run })
    ).rejects.toThrow('changed after review');
    expect(
      bodies(f).filter((b) => b.query.includes('CompleteRecoveryDraft'))
    ).toHaveLength(0);
  });
  it('links a returning customer found by email when the phone does not match', async () => {
    const f = fixture();
    (f.tables.shopify_pending_checkouts[0].payload as Row).email = 'Test@Example.com';
    f.setCustomers([
      {
        id: 'gid://shopify/Customer/7',
        defaultPhoneNumber: { phoneNumber: '+911111111111' },
        defaultEmailAddress: { emailAddress: 'test@example.com' },
      },
    ]);
    await prepareRecoveryOrder(f.db, f.run, 'cod');
    const calls = bodies(f);
    expect(calls.some((b) => b.query.includes('RecoveryCustomerCreate'))).toBe(false);
    expect(
      calls.find((b) => b.query.includes('mutation RecoveryDraft')).variables
        .input.purchasingEntity
    ).toEqual({ customerId: 'gid://shopify/Customer/7' });
  });
  it('looks the customer up again when Shopify says they already exist', async () => {
    const f = fixture();
    f.setCustomers(
      [],
      { customer: null, userErrors: [{ message: 'Phone has already been taken' }] },
      [
        {
          id: 'gid://shopify/Customer/8',
          defaultPhoneNumber: { phoneNumber: '919876543210' },
          defaultEmailAddress: null,
        },
      ]
    );
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).resolves.toMatchObject({
      status: 'quoted',
    });
    expect(
      bodies(f).find((b) => b.query.includes('mutation RecoveryDraft')).variables
        .input.purchasingEntity
    ).toEqual({ customerId: 'gid://shopify/Customer/8' });
  });
  it('keeps Shopify customer errors out of the routing message and frees the checkout', async () => {
    const f = fixture();
    f.setCustomers([], {
      customer: null,
      userErrors: [{ message: 'Email has already been taken' }],
    });
    const error = await prepareRecoveryOrder(f.db, f.run, 'cod').catch((e) => e);
    expect(error.message).toBe('The checkout customer could not be linked in Shopify.');
    // "already" in the message would route the customer to an agent instead of checkout.
    expect(error.message).not.toMatch(/already/i);
    expect(error.cause).toBe('Email has already been taken');
    expect(f.tables.shopify_checkout_recoveries).toHaveLength(0);
  });
  it('blocks a customer who already placed an order after checkout', async () => {
    const f = fixture();
    f.setRecentOrders([
      { phone: '+919876543210', cancelledAt: null, shippingAddress: null },
    ]);
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'already placed'
    );
  });
  it('requires server-recorded COD confirmation and creates one order on retries', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
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
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
    f.run.vars.checkout_recovery_id = r.id;
    f.run.vars.checkout_order_summary = 'Not the displayed quote';
    await expect(confirmRecoveryCod(f.db, f.run)).rejects.toThrow('Review');
    f.run.contact_id = 'other-customer';
    await expect(prepareRecoveryOrder(f.db, f.run, 'cod')).rejects.toThrow(
      'another customer'
    );
  });
  it('creates a paid order only for the exact verified checkout payment', async () => {
    const f = fixture();
    const r = await prepareRecoveryOrder(f.db, f.run, 'prepaid');
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
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
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
    const r = await prepareRecoveryOrder(f.db, f.run, 'cod');
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
