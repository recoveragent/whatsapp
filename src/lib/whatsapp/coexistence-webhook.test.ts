import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { handleCoexistenceWebhookChange } from './coexistence-webhook';

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn().mockResolvedValue({ id: 'contact-1', phone: '918489406020' }),
}));

vi.mock('@/lib/inbox/ensure-conversation', () => ({
  ensureConversationForContact: vi.fn().mockResolvedValue({ id: 'conv-1' }),
}));

function makeSupabaseStub() {
  const inserts: Record<string, unknown>[] = [];

  const chain = {
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: { id: 'x' }, error: null }),
    select: () => chain,
    insert: (row: Record<string, unknown>) => {
      inserts.push(row);
      return Promise.resolve({ error: null });
    },
    update: () => ({
      eq: () => Promise.resolve({ error: null }),
    }),
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

  return { stub: stub as unknown as SupabaseClient, inserts };
}

describe('handleCoexistenceWebhookChange — smb_message_echoes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('ingests outbound echoes from message_echoes (not messages)', async () => {
    const { stub, inserts } = makeSupabaseStub();

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
  });
});
