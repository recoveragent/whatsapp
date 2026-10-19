import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginPaymentCollection,
  processPaymentCollections,
} from './collect-payment';
import type { FlowRunRow, FlowNodeRow } from '@/lib/flows/types';

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/flows/extended-nodes', () => ({ executeExtendedNode: h.send }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
type Row = Record<string, unknown>;

function database(tables: Record<string, Row[]>) {
  const rpc = vi.fn(
    async (
      _name: string,
      args: { p_request_id: string; p_outcome: string }
    ) => {
      const row = tables.flow_payment_requests.find(
        (r) => r.id === args.p_request_id
      )!;
      if (row.status === 'pending') row.status = args.p_outcome;
      return { error: null, data: true };
    }
  );
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | undefined;
    let insertion: Row | undefined;
    const execute = () => {
      if (insertion) {
        if (
          (tables[table] ?? []).some(
            (r) =>
              r.flow_run_id === insertion!.flow_run_id &&
              r.node_key === insertion!.node_key
          )
        )
          return { data: [], error: { code: '23505' } };
        (tables[table] ??= []).push({ status: 'creating', ...insertion });
      }
      const rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r))
      );
      if (patch) rows.forEach((row) => Object.assign(row, patch));
      return { data: structuredClone(rows), error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      is: (k: string, v: unknown) => {
        filters.push((r) => r[k] === v);
        return b;
      },
      lte: (k: string, v: string) => {
        filters.push((r) => String(r[k]) <= v);
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      insert: (row: Row) => {
        insertion = row;
        return b;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[key]));
        return b;
      },
      maybeSingle: async () => {
        const r = execute();
        return { ...r, data: r.data[0] ?? null };
      },
      single: async () => {
        const r = execute();
        return { ...r, data: r.data[0] ?? null };
      },
      then: (resolve: (r: ReturnType<typeof execute>) => unknown) =>
        Promise.resolve(resolve(execute())),
    };
    return b;
  };
  return { db: { from, rpc } as unknown as SupabaseClient, rpc };
}

function fixture() {
  const tables: Record<string, Row[]> = {
    account_payment_connections: [
      {
        account_id: 'brand',
        enabled: true,
        key_id: 'key',
        key_secret_encrypted: 'secret',
        webhook_secret_encrypted: 'webhook',
      },
    ],
    flow_runs: [
      {
        id: 'run',
        account_id: 'brand',
        status: 'waiting',
        current_node_key: 'collect',
        vars: { payment_url: 'https://rzp.io/rzp/test' },
      },
    ],
    flow_payment_requests: [
      {
        id: 'request',
        account_id: 'brand',
        flow_run_id: 'run',
        node_key: 'collect',
        provider_link_id: 'plink_1',
        amount_paise: 19900,
        status: 'pending',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        next_check_at: new Date(0).toISOString(),
        reminder_at: new Date(0).toISOString(),
        reminder_claimed_at: null,
        reminders_sent: 0,
        config: {
          max_reminders: 2,
          reminder_minutes: 30,
          reminder_template: { template_name: 'reminder' },
        },
      },
    ],
  };
  const created = {
    id: 'plink_1',
    reference_id: 'request',
    amount: 19900,
    amount_paid: 0,
    currency: 'INR',
    status: 'created',
  };
  const fetch = vi
    .fn()
    .mockImplementation(async () => ({ ok: true, json: async () => created }));
  vi.stubGlobal('fetch', fetch);
  return {
    ...database(tables),
    tables,
    row: tables.flow_payment_requests[0],
    created,
    fetch,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  h.send.mockReset().mockResolvedValue({ kind: 'continue', nextKey: '' });
});
function newCollectionFixture() {
  const f = fixture();
  f.tables.flow_payment_requests = [];
  f.tables.message_templates = [
    {
      account_id: 'brand',
      name: 'collect',
      language: 'en_US',
      status: 'APPROVED',
      buttons: [],
    },
  ];
  f.tables.contacts = [
    {
      id: 'contact',
      account_id: 'brand',
      phone: '+919000000000',
      name: 'Test customer',
    },
  ];
  Object.assign(f.tables.flow_runs[0], {
    status: 'active',
    contact_id: 'contact',
    vars: {},
  });
  f.fetch.mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => ({
      ...f.created,
      reference_id: JSON.parse(init.body).reference_id,
      short_url: 'https://rzp.io/rzp/test',
    }),
  }));
  const template = {
    template_name: 'collect',
    language: 'en_US',
    variables: { '1': '{{ vars.payment_url }}' },
    next_node_key: '',
  };
  const node = {
    node_key: 'collect',
    node_type: 'collect_payment',
    config: {
      provider: 'razorpay',
      currency: 'INR',
      amount: 199,
      description: 'Advance',
      expiry_hours: 24,
      reminder_minutes: 60,
      max_reminders: 2,
      request_template: template,
      reminder_template: template,
    },
  } as unknown as FlowNodeRow;
  return { ...f, run: f.tables.flow_runs[0] as unknown as FlowRunRow, node };
}

describe('starting a payment collection', () => {
  it('creates an exact fixed-amount link, persists variables and waits', async () => {
    const f = newCollectionFixture();
    await beginPaymentCollection(f.db, f.run, f.node);
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toMatchObject({
      amount: 19900,
      accept_partial: false,
      currency: 'INR',
      reminder_enable: false,
    });
    expect(f.tables.flow_payment_requests[0].status).toBe('pending');
    expect(f.tables.flow_runs[0].status).toBe('waiting');
    expect(f.run.vars).toMatchObject({
      payment_url: 'https://rzp.io/rzp/test',
      payment_amount: '199.00',
      payment_collection_status: 'pending',
    });
  });
  it('does not create or send twice when two invocations start the same collection', async () => {
    const f = newCollectionFixture();
    await Promise.all([
      beginPaymentCollection(f.db, f.run, f.node),
      beginPaymentCollection(f.db, f.run, f.node),
    ]);
    expect(f.tables.flow_payment_requests).toHaveLength(1);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('keeps a payable link tracked if the request message fails', async () => {
    const f = newCollectionFixture();
    h.send.mockResolvedValue({ kind: 'error', message: 'Delivery unknown' });
    await beginPaymentCollection(f.db, f.run, f.node);
    expect(f.tables.flow_payment_requests[0]).toMatchObject({
      status: 'pending',
      last_error: 'Delivery unknown',
    });
    expect(f.tables.flow_runs[0].status).toBe('waiting');
  });
});

describe('unpaid reminder processing', () => {
  it('checks the provider again before sending and schedules the next reminder', async () => {
    const f = fixture();
    await processPaymentCollections(f.db);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(f.row.reminders_sent).toBe(1);
    expect(f.row.reminder_claimed_at).toBeNull();
    expect(Date.parse(f.row.reminder_at as string)).toBeGreaterThan(Date.now());
  });
  it('stops reminders and resolves the paid branch when the gateway reports payment', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...f.created, status: 'paid', amount_paid: 19900 }),
    });
    await processPaymentCollections(f.db);
    expect(h.send).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith('resolve_flow_payment', {
      p_request_id: 'request',
      p_outcome: 'paid',
    });
  });
  it('avoids an unpaid reminder when payment arrives during the reminder claim', async () => {
    const f = fixture();
    f.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => f.created })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...f.created,
          status: 'paid',
          amount_paid: 19900,
        }),
      });
    await processPaymentCollections(f.db);
    expect(h.send).not.toHaveBeenCalled();
    expect(f.row.status).toBe('paid');
  });
  it('does not duplicate reminders when two cron workers overlap', async () => {
    const f = fixture();
    await Promise.all([
      processPaymentCollections(f.db),
      processPaymentCollections(f.db),
    ]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it.each(['handed_off', 'completed', 'paused_by_agent'])(
    'does not remind a %s run',
    async (status) => {
      const f = fixture();
      f.tables.flow_runs[0].status = status;
      await processPaymentCollections(f.db);
      expect(h.send).not.toHaveBeenCalled();
    }
  );
  it('respects the maximum count and local expiry even before provider expiry', async () => {
    for (const patch of [
      { reminders_sent: 2 },
      { expires_at: new Date(0).toISOString() },
    ]) {
      const f = fixture();
      Object.assign(f.row, patch);
      await processPaymentCollections(f.db);
      expect(h.send).not.toHaveBeenCalled();
    }
  });
  it('records gateway errors without treating them as a payment failure', async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new Error('Network unavailable'));
    await processPaymentCollections(f.db);
    expect(f.row.status).toBe('pending');
    expect(f.row.last_error).toBe('Network unavailable');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('keeps an ambiguous send claimed to prevent duplicate charged messages', async () => {
    const f = fixture();
    h.send.mockResolvedValue({ kind: 'error', message: 'Delivery unknown' });
    await processPaymentCollections(f.db);
    expect(f.row.reminder_claimed_at).not.toBeNull();
    expect(f.row.last_error).toBe('Delivery unknown');
    f.row.next_check_at = new Date(0).toISOString();
    await processPaymentCollections(f.db);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe('Cashfree flow lifecycle', () => {
  it('rejects a Razorpay template before creating a Cashfree link', async () => {
    const f = newCollectionFixture();
    f.node.config.provider = 'cashfree';
    f.tables.account_cashfree_connections = [
      {
        account_id: 'brand',
        enabled: true,
        client_id: 'app',
        client_secret_encrypted: 'secret',
        environment: 'production',
      },
    ];
    f.tables.message_templates[0].buttons = [
      {
        type: 'URL',
        text: 'Pay now',
        url: 'https://rzp.io/{{1}}',
        url_purpose: 'payment',
      },
    ];
    await expect(beginPaymentCollection(f.db, f.run, f.node)).rejects.toThrow(
      'payments.cashfree.com'
    );
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.tables.flow_payment_requests).toEqual([]);
  });

  function cashfreeFixture() {
    const f = newCollectionFixture();
    f.node.config.provider = 'cashfree';
    f.tables.account_cashfree_connections = [
      {
        account_id: 'brand',
        enabled: true,
        client_id: 'app',
        client_secret_encrypted: 'cashfree-secret',
        environment: 'sandbox',
      },
    ];
    f.fetch.mockImplementation(async (_url, init) => ({
      ok: true,
      json: async () => ({
        link_id: JSON.parse(init.body).link_id,
        link_url: 'https://payments-test.cashfree.com/links/test',
        link_status: 'ACTIVE',
        link_currency: 'INR',
        link_amount: 199,
        link_amount_paid: 0,
      }),
    }));
    return f;
  }
  it('creates a Cashfree link and parks the run without using Razorpay', async () => {
    const f = cashfreeFixture();
    await beginPaymentCollection(f.db, f.run, f.node);
    expect(f.fetch.mock.calls[0][0]).toBe(
      'https://sandbox.cashfree.com/pg/links'
    );
    const body = JSON.parse(f.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      link_amount: 199,
      link_partial_payments: false,
      link_auto_reminders: false,
      customer_details: { customer_phone: '9000000000' },
    });
    expect(f.run.vars.payment_url_suffix).toBe('links/test');
    expect(f.tables.flow_runs[0].status).toBe('waiting');
    expect(f.tables.flow_payment_requests[0].config).toMatchObject({
      provider: 'cashfree',
    });
  });
  it('reconciles a paid Cashfree link through the shared resolver and stops reminders', async () => {
    const f = cashfreeFixture();
    await beginPaymentCollection(f.db, f.run, f.node);
    const row = f.tables.flow_payment_requests[0];
    row.next_check_at = new Date(0).toISOString();
    f.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        link_id: row.id,
        link_url: row.payment_url,
        link_status: 'PAID',
        link_currency: 'INR',
        link_amount: 199,
        link_amount_paid: 199,
      }),
    }));
    h.send.mockClear();
    await processPaymentCollections(f.db);
    expect(f.rpc).toHaveBeenCalledWith('resolve_flow_payment', {
      p_request_id: row.id,
      p_outcome: 'paid',
    });
    expect(h.send).not.toHaveBeenCalled();
  });
});
