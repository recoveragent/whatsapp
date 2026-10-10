import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { handleCoexistenceWebhookChange } from './coexistence-webhook';

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '918489406020' }),
}));

vi.mock('@/lib/inbox/ensure-conversation', () => ({
  ensureConversationForContact: vi.fn().mockResolvedValue({ id: 'conv-1' }),
}));

function makeSupabaseStub(status = 'connected', lastMessageAt: string | null = null) {
  const inserts: Record<string, unknown>[] = [];
  const conversation: Record<string, unknown> = {
    status: 'closed', last_message_at: lastMessageAt,
    last_message_text: 'Recent reply', last_customer_message_at: lastMessageAt,
  };

  const chain = {
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: { id: 'x' }, error: null }),
    select: () => chain,
    insert: (row: Record<string, unknown>) => {
      inserts.push(row);
      return Promise.resolve({ error: null });
    },
    update: (row: Record<string, unknown>) => {
      let matches = true;
      const update = {
        eq: (key: string, value: unknown) => {
          if (key !== 'id') matches &&= conversation[key] === value;
          return update;
        },
        or: (filter: string) => {
          const [nullFilter, timeFilter] = filter.split(',');
          const key = nullFilter.split('.')[0];
          const cutoff = timeFilter.split('.lte.')[1];
          matches &&= conversation[key] == null || String(conversation[key]) <= cutoff;
          return update;
        },
        then: (resolve: (value: { error: null }) => unknown) => {
          if (matches) Object.assign(conversation, row);
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return update;
    },
  };

  const stub = {
    from: (table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    status,
                    account_id: 'acc-1',
                    user_id: 'user-1',
                    phone_number_id: 'PN_1',
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ count: 0, error: null }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      return chain;
    },
  };

  return { stub: stub as unknown as SupabaseClient, inserts, conversation };
}

describe('handleCoexistenceWebhookChange — smb_message_echoes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ignores a retired secondary sender', async () => {
    const { stub, inserts } = makeSupabaseStub('disconnected');
    await handleCoexistenceWebhookChange({
      field: 'smb_message_echoes',
      value: { metadata: { phone_number_id: 'PN_1' }, message_echoes: [{ id: 'retired', type: 'text', text: { body: 'Old sender' } }] },
    }, stub);
    expect(inserts).toHaveLength(0);
  });

  it('ingests outbound echoes from message_echoes (not messages)', async () => {
    const { stub, inserts, conversation } = makeSupabaseStub();

    await handleCoexistenceWebhookChange(
      {
        field: 'smb_message_echoes',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '918750963486',
            phone_number_id: 'PN_1',
          },
          message_echoes: [
            {
              from: '918750963486',
              to: '918489406020',
              id: 'wamid.echo123',
              timestamp: '1739321024',
              type: 'text',
              text: { body: 'Reply from Business app' },
            },
          ],
        },
      },
      stub,
    );

    const msg = inserts.find((row) => row.message_id === 'wamid.echo123');
    expect(msg).toMatchObject({
      sender_type: 'agent',
      content_text: 'Reply from Business app',
      conversation_id: 'conv-1',
    });
    expect(conversation).toMatchObject({
      status: 'open',
      last_message_text: 'Reply from Business app',
      last_message_at: new Date(1739321024 * 1000).toISOString(),
    });
  });

  it('keeps recent activity and closed status when older history arrives', async () => {
    const recent = '2026-10-10T07:00:00.000Z';
    const { stub, inserts, conversation } = makeSupabaseStub('connected', recent);
    await handleCoexistenceWebhookChange({
      field: 'history',
      value: {
        metadata: { phone_number_id: 'PN_1' },
        messages: [{ id: 'old-history', from: '918489406020', timestamp: '1739321024', type: 'text', text: { body: 'Old reply' } }],
      },
    }, stub);
    expect(inserts).toHaveLength(1);
    expect(conversation).toMatchObject({
      status: 'closed', last_message_at: recent,
      last_customer_message_at: recent, last_message_text: 'Recent reply',
    });
  });
});
