import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleRateLimitStatus,
  isRateLimitFailure,
  nextRetryAt,
  processDueRateLimitRetries,
  RATE_LIMIT_MAX_RESENDS,
  trackTemplateForRateLimitRetry,
} from './rate-limit-retry';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => state.db }));
vi.mock('./encryption', () => ({ decrypt: () => 'token' }));
vi.mock('./broadcast-core', () => ({ finalizeBroadcastStatus: vi.fn() }));

type Row = Record<string, unknown>;
const payload = {
  messaging_product: 'whatsapp',
  to: '919876543210',
  type: 'template',
  template: { name: 'abc_1', language: { code: 'en' }, components: [] },
};

// Minimal in-memory PostgREST stand-in; filters run at execution time so
// conditional UPDATEs behave like Postgres claims.
function database() {
  const tables: Record<string, Row[]> = {
    whatsapp_config: [
      {
        id: 'config',
        account_id: 'account',
        phone_number_id: 'number',
        access_token: 'encrypted',
        status: 'connected',
      },
    ],
    message_templates: [
      {
        account_id: 'account',
        whatsapp_config_id: 'config',
        name: 'abc_1',
        language: 'en',
        category: 'Marketing',
      },
    ],
    message_delivery_events: [],
    rate_limit_retries: [],
    messages: [],
    shopify_message_log: [],
    shopify_orders: [],
    broadcasts: [],
    broadcast_recipients: [],
  };
  let seq = 0;
  const db = {
    from(name: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let insertion: Row | null = null;
      let removing = false;
      let mode: 'many' | 'single' | 'maybe' = 'many';
      const run = () => {
        const table = tables[name]!;
        if (insertion) {
          const row = {
            id: `row-${++seq}`,
            attempts: 0,
            status: 'tracking',
            created_at: new Date().toISOString(),
            ...insertion,
          };
          table.push(row);
          return [row];
        }
        const hits = table.filter((r) => filters.every((f) => f(r)));
        if (removing) {
          tables[name] = table.filter((r) => !hits.includes(r));
          return hits;
        }
        if (patch) for (const r of hits) Object.assign(r, patch);
        return hits;
      };
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        or: () => query,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), query),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), query),
        lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), query),
        lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), query),
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), query),
        like: (k: string, v: string) => (
          filters.push((r) => String(r[k] ?? '').endsWith(v.replace('%', ''))), query
        ),
        update: (v: Row) => ((patch = v), query),
        insert: (v: Row) => ((insertion = v), query),
        delete: () => ((removing = true), query),
        single: () => ((mode = 'single'), query),
        maybeSingle: () => ((mode = 'maybe'), query),
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          const rows = run();
          const data = mode === 'many' ? rows : (rows[0] ?? null);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, tables };
}

function metaReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('rate limit retry helpers', () => {
  it('detects 130429 only', () => {
    expect(isRateLimitFailure([{ code: 130429 }])).toBe(true);
    expect(isRateLimitFailure([{ code: 131049 }])).toBe(false);
    expect(isRateLimitFailure(undefined)).toBe(false);
  });

  it('backs off 2m / 10m / 30m then stops', () => {
    const now = 0;
    const noJitter = () => 0;
    expect(nextRetryAt(0, now, noJitter)).toBe(new Date(2 * 60_000).toISOString());
    expect(nextRetryAt(1, now, noJitter)).toBe(new Date(10 * 60_000).toISOString());
    expect(nextRetryAt(2, now, noJitter)).toBe(new Date(30 * 60_000).toISOString());
    expect(nextRetryAt(RATE_LIMIT_MAX_RESENDS, now, noJitter)).toBeNull();
  });
});

describe('rate limit retry lifecycle', () => {
  let fixture: ReturnType<typeof database>;
  beforeEach(() => {
    fixture = database();
    state.db = fixture.db;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('snapshots a send, schedules on 130429 and resends via cron', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    const [row] = fixture.tables.rate_limit_retries;
    expect(row).toMatchObject({ status: 'tracking', template_category: 'Marketing' });

    fixture.tables.messages.push({
      id: 'msg',
      message_id: 'wamid-1',
      status: 'failed',
      'conversations.account_id': 'account',
      'conversations.whatsapp_config_id': 'config',
    });
    await handleRateLimitStatus(fixture.db, 'number', {
      id: 'wamid-1',
      status: 'failed',
      errors: [{ code: 130429 }],
    });
    expect(row.status).toBe('scheduled');

    row.next_attempt_at = new Date(Date.now() - 1000).toISOString();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      metaReply({ messages: [{ id: 'wamid-2' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await processDueRateLimitRetries(fixture.db)).toBe(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual(payload);
    expect(row).toMatchObject({ status: 'resent', attempts: 1, current_message_id: 'wamid-2' });
    expect(fixture.tables.messages[0]).toMatchObject({ message_id: 'wamid-2', status: 'sent' });

    await handleRateLimitStatus(fixture.db, 'number', { id: 'wamid-2', status: 'delivered' });
    expect(row.status).toBe('delivered');
  });

  it('gives up after the maximum number of resends', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    const [row] = fixture.tables.rate_limit_retries;
    Object.assign(row, {
      status: 'resent',
      attempts: RATE_LIMIT_MAX_RESENDS,
      current_message_id: 'wamid-4',
    });
    await handleRateLimitStatus(fixture.db, 'number', {
      id: 'wamid-4',
      status: 'failed',
      errors: [{ code: 130429 }],
    });
    expect(row.status).toBe('failed');
  });

  it('drops the snapshot once the first attempt is delivered', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    await handleRateLimitStatus(fixture.db, 'number', { id: 'wamid-1', status: 'delivered' });
    expect(fixture.tables.rate_limit_retries).toHaveLength(0);
  });

  it('schedules when the 130429 webhook beat the snapshot insert', async () => {
    fixture.tables.message_delivery_events.push({
      account_id: 'account',
      phone_number_id: 'number',
      message_id: 'wamid-1',
      event_type: 'failed',
      details: { errors: [{ code: 130429 }] },
    });
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    expect(fixture.tables.rate_limit_retries[0]!.status).toBe('scheduled');
  });

  it('skips a marketing resend when the customer ordered since', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    const [row] = fixture.tables.rate_limit_retries;
    Object.assign(row, {
      status: 'scheduled',
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    });
    fixture.tables.shopify_orders.push({
      account_id: 'account',
      customer_phone: '+919876543210',
      ordered_at: new Date(Date.now() + 1000).toISOString(),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await processDueRateLimitRetries(fixture.db)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(row.status).toBe('skipped');
  });

  it('reschedules when the resend itself is rate limited', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    const [row] = fixture.tables.rate_limit_retries;
    Object.assign(row, {
      status: 'scheduled',
      next_attempt_at: new Date(Date.now() - 1000).toISOString(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => metaReply({ error: { code: 130429, message: 'Rate limit hit' } }, 400)),
    );
    await processDueRateLimitRetries(fixture.db);
    expect(row).toMatchObject({ status: 'scheduled', attempts: 1 });
  });

  it('does not retry other failure codes', async () => {
    await trackTemplateForRateLimitRetry('number', payload, 'wamid-1');
    await handleRateLimitStatus(fixture.db, 'number', {
      id: 'wamid-1',
      status: 'failed',
      errors: [{ code: 131026 }],
    });
    expect(fixture.tables.rate_limit_retries).toHaveLength(0);
  });
});
