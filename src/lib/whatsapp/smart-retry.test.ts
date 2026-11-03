import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import {
  acceptRecovery,
  handleRecoveryStatus,
  promptTemplateError,
  RECOVERY_PREFIX,
  trackRecoverableTemplate,
} from './smart-retry';

const state = vi.hoisted(() => ({ db: null as unknown, sends: 0 }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => state.db }));
vi.mock('./encryption', () => ({ decrypt: () => 'token' }));
vi.mock('@/lib/wallet/billing', () => ({
  assertWalletCanSend: vi.fn(),
  debitWalletForTemplateSend: vi.fn(),
}));

const id = '11111111-1111-4111-8111-111111111111';
const template = {
  id: 'prompt',
  user_id: 'user',
  whatsapp_config_id: 'config',
  account_id: 'account',
  name: 'receive_message',
  language: 'en',
  category: 'Utility',
  status: 'APPROVED',
  body_text: 'A message from {{1}} is waiting.',
  buttons: [{ type: 'QUICK_REPLY', text: 'Receive message' }],
  created_at: '2026-11-03T00:00:00Z',
};
const original = {
  ...template,
  id: 'original',
  name: 'offer',
  category: 'Marketing',
  body_text: 'Offer for {{1}}',
};
const payload = {
  messaging_product: 'whatsapp',
  to: '919876543210',
  type: 'template',
  template: {
    name: 'offer',
    language: { code: 'en' },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: 'Alice' }] },
      {
        type: 'header',
        parameters: [
          { type: 'image', image: { link: 'https://example.com/image.jpg' } },
        ],
      },
    ],
  },
};
type Row = Record<string, unknown>;

// Evaluate filters at execution time, matching Postgres conditional UPDATEs.
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
    smart_retry_settings: [
      {
        whatsapp_config_id: 'config',
        enabled: true,
        template_id: 'prompt',
        company_name: 'Acme',
      },
    ],
    message_templates: [template, original],
    message_delivery_events: [],
    smart_retry_messages: [],
    messages: [],
    broadcasts: [],
    contacts: [],
    broadcast_recipients: [],
  };
  let cooldown = false;
  const db = {
    from(name: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | null = null;
      let insertion: Row | null = null;
      let single = false;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((r) => r[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((r) => values.includes(r[key]));
          return query;
        },
        gt: (key: string, value: string) => {
          filters.push((r) => String(r[key]) > value);
          return query;
        },
        limit: () => query,
        update: (values: Row) => {
          patch = values;
          return query;
        },
        insert: (values: Row) => {
          insertion = values;
          return query;
        },
        single: () => {
          single = true;
          return query;
        },
        maybeSingle: () => {
          single = true;
          return query;
        },
        then(resolve: (result: unknown) => unknown) {
          if (insertion)
            tables[name]!.push({
              id,
              status: 'tracking',
              expires_at: new Date(Date.now() + 172800000).toISOString(),
              ...insertion,
            });
          const rows = tables[name]!.filter((row) =>
            filters.every((filter) => filter(row))
          );
          if (patch) rows.forEach((row) => Object.assign(row, patch));
          return Promise.resolve(
            resolve({ data: single ? (rows[0] ?? null) : rows, error: null })
          );
        },
      };
      return query;
    },
    rpc: async () => {
      const claimed = !cooldown;
      cooldown = true;
      return { data: claimed, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, tables };
}

describe('131049 smart retry', () => {
  let fixture: ReturnType<typeof database>;
  beforeEach(() => {
    fixture = database();
    state.db = fixture.db;
    state.sends = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ messages: [{ id: `send-${++state.sends}` }] }),
            { status: 200 }
          )
      )
    );
  });

  async function failed(code = 131049) {
    await trackRecoverableTemplate('number', payload, 'original-wamid');
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'original-wamid',
      status: 'failed',
      errors: [{ code }],
    });
  }
  const accept = (
    account = 'account',
    config = 'config',
    phone = payload.to,
    context = 'send-1'
  ) =>
    acceptRecovery(
      fixture.db,
      account,
      config,
      phone,
      RECOVERY_PREFIX + id,
      context
    );

  it('only prompts for 131049, never other errors or an accepted/sent event', async () => {
    await failed(131026);
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'original-wamid',
      status: 'sent',
    });
    expect(fetch).not.toHaveBeenCalled();
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'original-wamid',
      status: 'failed',
      errors: [{ code: 131049 }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).template
        .components
    ).toContainEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: RECOVERY_PREFIX + id }],
    });
  });

  it('recovers a 131049 webhook that arrived before the send snapshot was recorded', async () => {
    fixture.tables.message_delivery_events!.push({
      account_id: 'account',
      phone_number_id: 'number',
      message_id: 'original-wamid',
      event_type: 'failed',
      details: { errors: [{ code: 131049 }] },
    });
    await trackRecoverableTemplate('number', payload, 'original-wamid');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.tables.smart_retry_messages![0]!.status).toBe(
      'awaiting_acceptance'
    );
  });

  it('duplicate failure webhooks and repeated button clicks send once each', async () => {
    await failed();
    await Promise.all(
      [1, 2].map(() =>
        handleRecoveryStatus(fixture.db, 'number', {
          id: 'original-wamid',
          status: 'failed',
          errors: [{ code: 131049 }],
        })
      )
    );
    await Promise.all([accept(), accept()]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)
    ).toEqual(payload);
    expect(fixture.tables.smart_retry_messages![0]!.status).toBe('resent');
  });

  it('rejects tokens from another account, number, recipient or prompt', async () => {
    await failed();
    await accept('other');
    await accept('account', 'other');
    await accept('account', 'config', '919999999999');
    await accept('account', 'config', payload.to, 'wrong-context');
    expect(fetch).toHaveBeenCalledTimes(1);
    await accept();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not replay expired messages', async () => {
    await failed();
    fixture.tables.smart_retry_messages![0]!.expires_at =
      '2000-01-01T00:00:00Z';
    await accept();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('cancels recovery when original delivery arrives before acceptance', async () => {
    await failed();
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'original-wamid',
      status: 'delivered',
    });
    await accept();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for utility messages or the recovery template itself', async () => {
    await trackRecoverableTemplate(
      'number',
      {
        ...payload,
        template: { name: template.name, language: { code: 'en' } },
      },
      'prompt-wamid'
    );
    expect(fixture.tables.smart_retry_messages).toHaveLength(0);
  });

  it('records synchronous 131049 rejection and prompts without a wamid', async () => {
    await trackRecoverableTemplate('number', payload, null, 131049);
    expect(fetch).toHaveBeenCalledTimes(1);
    await accept();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('respects disabled settings both before prompting and after prompting', async () => {
    fixture.tables.smart_retry_settings![0]!.enabled = false;
    await trackRecoverableTemplate('number', payload, 'original-wamid');
    expect(fixture.tables.smart_retry_messages).toHaveLength(0);
    fixture.tables.smart_retry_settings![0]!.enabled = true;
    await failed();
    fixture.tables.smart_retry_settings![0]!.enabled = false;
    await accept();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the resend also fails with 131049', async () => {
    await failed();
    await accept();
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'send-2',
      status: 'failed',
      errors: [{ code: 131049 }],
    });
    await accept();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fixture.tables.smart_retry_messages![0]!.status).toBe('failed');
  });

  it('records prompt rejection without retrying the prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 131049 } }), {
            status: 400,
          })
      )
    );
    await failed();
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'original-wamid',
      status: 'failed',
      errors: [{ code: 131049 }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.tables.smart_retry_messages![0]!.status).toBe('failed');
  });

  it('blocks replay if original template is paused', async () => {
    await failed();
    fixture.tables.message_templates![1] = { ...original, status: 'PAUSED' };
    await accept();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('enforces recipient cooldown across different failed messages', async () => {
    await failed();
    fixture.tables.smart_retry_messages![0]!.id = 'old-recovery';
    await trackRecoverableTemplate('number', payload, 'another-wamid');
    await handleRecoveryStatus(fixture.db, 'number', {
      id: 'another-wamid',
      status: 'failed',
      errors: [{ code: 131049 }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.tables.smart_retry_messages![1]!.status).toBe('suppressed');
  });

  it('requires a suitable approved quick-reply template without assuming Utility', () => {
    expect(promptTemplateError(template as MessageTemplate)).toBeNull();
    expect(
      promptTemplateError({
        ...template,
        category: 'Marketing',
      } as MessageTemplate)
    ).toBeNull();
    expect(
      promptTemplateError({
        ...template,
        buttons: [],
      } as unknown as MessageTemplate)
    ).toBeTruthy();
    expect(
      promptTemplateError({
        ...template,
        body_text: '{{2}}',
      } as MessageTemplate)
    ).toBeTruthy();
    expect(
      promptTemplateError({
        ...template,
        header_type: 'image',
      } as MessageTemplate)
    ).toBeTruthy();
  });
});
