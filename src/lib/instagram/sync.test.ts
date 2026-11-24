import { describe, expect, it } from 'vitest';
import { conversationUsernames, conversationsToEvents, parseGraphTime } from './sync';

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
