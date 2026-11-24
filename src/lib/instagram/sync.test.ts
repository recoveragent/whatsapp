import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { conversationUsernames, conversationsToEvents, isKnownOutbound, parseGraphTime } from './sync';
import type { InstagramEvent } from './webhook';

const NOW = Date.parse('2026-11-23T17:00:00Z');
const opts = { now: NOW, notBefore: NOW - 24 * 60 * 60_000 };
const msg = (id: string, from: string, to: string, at: string, message?: string) => ({ id, created_time: at, from: { id: from }, to: { data: [{ id: to }] }, message });

describe('Instagram API sync', () => {
  it('parses Graph timestamps with +0000 offsets', () => {
    expect(parseGraphTime('2026-11-23T16:51:51+0000')).toBe(Date.parse('2026-11-23T16:51:51Z'));
    expect(parseGraphTime(undefined)).toBeNaN();
  });

  it('maps inbound and outbound messages in recent conversations', () => {
    expect(conversationsToEvents('123', [{ updated_time: '2026-11-23T16:55:00+0000', messages: { data: [
      msg('m2', '123', '456', '2026-11-23T16:55:00+0000', 'Thanks'),
      msg('m1', '456', '123', '2026-11-23T16:54:00+0000', 'Hello'),
      msg('m0', '456', '123', '2026-11-23T16:53:00+0000'),
    ] } }], opts)).toEqual([
      { accountId: '123', participantId: '456', messageId: 'm2', direction: 'outbound', text: 'Thanks', at: '2026-11-23T16:55:00.000Z' },
      { accountId: '123', participantId: '456', messageId: 'm1', direction: 'inbound', text: 'Hello', at: '2026-11-23T16:54:00.000Z' },
      { accountId: '123', participantId: '456', messageId: 'm0', direction: 'inbound', text: '[Attachment]', at: '2026-11-23T16:53:00.000Z' },
    ]);
  });

  it('collects customer usernames and ignores the business account and invalid names', () => {
    const names = conversationUsernames('123', [{ messages: { data: [
      { id: 'a', from: { id: '456', username: 'simran.k' }, to: { data: [{ id: '123', username: 'giftingstudio.in' }] } },
      { id: 'b', from: { id: '123', username: 'giftingstudio.in' }, to: { data: [{ id: '789', username: 'bad name!' }] } },
    ] } }]);
    expect([...names]).toEqual([['456', 'simran.k']]);
    expect(conversationUsernames('123', null).size).toBe(0);
  });

  it('skips stale conversations, old messages, and messages not involving the account', () => {
    expect(conversationsToEvents('123', [
      { updated_time: '2026-11-23T15:00:00+0000', messages: { data: [msg('old-conv', '456', '123', '2026-11-23T15:00:00+0000', 'x')] } },
      { updated_time: '2026-11-23T16:59:00+0000', messages: { data: [
        msg('too-old', '456', '123', '2026-11-21T10:00:00+0000', 'x'),
        msg('other', '456', '789', '2026-11-23T16:59:00+0000', 'x'),
        { id: 'broken', created_time: '2026-11-23T16:59:00+0000' },
      ] } },
    ], opts)).toEqual([]);
    expect(conversationsToEvents('123', null, opts)).toEqual([]);
  });
});

type Row = Record<string, string>;
/** Minimal in-memory stand-in that applies the filters the query sets. */
function fakeAdmin(tables: Record<string, Row[]>, failOn?: string): SupabaseClient {
  return { from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const error = failOn === table ? { message: 'db down' } : null;
    const q = {
      select: () => q,
      eq: (k: string, v: string) => { filters.push((r) => r[k] === v); return q; },
      gte: (k: string, v: string) => { filters.push((r) => r[k] >= v); return q; },
      lte: (k: string, v: string) => { filters.push((r) => r[k] <= v); return q; },
      maybeSingle: async () => ({ data: error ? null : rows()[0] ?? null, error }),
      then: (resolve: (v: unknown) => void) => resolve({ data: error ? null : rows(), error }),
    };
    return q;
  } } as unknown as SupabaseClient;
}

describe('outbound duplicate guard', () => {
  const threads = [{ id: 't1', connection_id: 'c1', participant_id: 'alice' }, { id: 't2', connection_id: 'c1', participant_id: 'bob' }];
  const stored = (thread_id: string, meta_message_id: string, created_at = '2026-11-23T16:55:00.000Z') => ({ thread_id, meta_message_id, direction: 'outbound', content: 'Thanks!', created_at });
  const reply = (participantId: string, messageId: string): InstagramEvent => ({ accountId: '123', participantId, messageId, direction: 'outbound', text: 'Thanks!', at: '2026-11-23T16:56:00.000Z' });

  it('keeps the same reply sent to a different customer', async () => {
    const admin = fakeAdmin({ instagram_threads: threads, instagram_messages: [stored('t1', 'send-id')] });
    expect(await isKnownOutbound(admin, 'c1', reply('bob', 'm2'), new Set(['m2']))).toBe(false);
  });

  it('recognises a reply already stored in the same conversation under another ID', async () => {
    const admin = fakeAdmin({ instagram_threads: threads, instagram_messages: [stored('t1', 'send-id')] });
    expect(await isKnownOutbound(admin, 'c1', reply('alice', 'm1'), new Set(['m1']))).toBe(true);
  });

  it('keeps a genuine repeat in the same conversation', async () => {
    const admin = fakeAdmin({ instagram_threads: threads, instagram_messages: [stored('t1', 'm1')] });
    expect(await isKnownOutbound(admin, 'c1', reply('alice', 'm2'), new Set(['m1', 'm2']))).toBe(false);
  });

  it('ignores old matches and new conversations, and reports database errors', async () => {
    const tables = { instagram_threads: threads, instagram_messages: [stored('t1', 'send-id', '2026-11-23T16:40:00.000Z')] };
    expect(await isKnownOutbound(fakeAdmin(tables), 'c1', reply('alice', 'm1'), new Set(['m1']))).toBe(false);
    expect(await isKnownOutbound(fakeAdmin(tables), 'c1', reply('carol', 'm1'), new Set(['m1']))).toBe(false);
    await expect(isKnownOutbound(fakeAdmin(tables, 'instagram_messages'), 'c1', reply('alice', 'm1'), new Set(['m1']))).rejects.toThrow('db down');
  });
});
