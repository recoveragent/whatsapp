import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildConversationContext } from './context';

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return chain as unknown as SupabaseClient;
}

describe('buildConversationContext', () => {
  it('keeps the button question and options before the customer selection', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: 'A4' },
        {
          sender_type: 'bot',
          content_text: 'Which size?',
          interactive_payload: {
            kind: 'buttons',
            buttons: [
              { id: '1', title: 'A4' },
              { id: '2', title: 'A3' },
            ],
          },
        },
      ]),
      'conv-1'
    );
    expect(out).toEqual([
      { role: 'assistant', content: 'Which size?\nReply choices: A4 | A3' },
      { role: 'user', content: 'A4' },
    ]);
  });
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ];
    const out = await buildConversationContext(fakeDb(rows), 'conv-1');
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
  });

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1'
    );
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }]);
  });

  it('keeps sent product IDs for follow-up recommendations', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'bot',
          content_text: 'Options',
          content_payload: {
            type: 'product_carousel',
            products: [
              { shopify_variant_id: 101 },
              { shopify_variant_id: 102 },
            ],
          },
        },
      ]),
      'conv-1'
    );
    expect(out[0].productVariantIds).toEqual([101, 102]);
  });

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1'
    );
    expect(out).toEqual([{ role: 'user', content: 'real' }]);
  });
});
