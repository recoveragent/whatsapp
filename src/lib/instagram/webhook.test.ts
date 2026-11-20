import { describe, expect, it } from 'vitest';
import { parseInstagramEvents } from './webhook';

describe('Instagram message notifications', () => {
  it('extracts incoming and echoed messages and ignores unrelated events', () => {
    expect(parseInstagramEvents({ object: 'instagram', entry: [{ id: '123', messaging: [
      { sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1700000000000, message: { mid: 'm1', text: 'Hello' } },
      { sender: { id: '123' }, recipient: { id: '456' }, timestamp: 1700000001000, message: { mid: 'm2', text: 'Hi', is_echo: true } },
      { sender: { id: '456' }, recipient: { id: '999' }, timestamp: 1700000001000, message: { mid: 'm3', text: 'Other' } },
      { sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1700000001000, read: {} },
    ] }] })).toEqual([
      { accountId: '123', participantId: '456', messageId: 'm1', direction: 'inbound', text: 'Hello', at: '2023-11-14T22:13:20.000Z' },
      { accountId: '123', participantId: '456', messageId: 'm2', direction: 'outbound', text: 'Hi', at: '2023-11-14T22:13:21.000Z' },
    ]);
  });
  it('ignores malformed and other channel payloads', () => {
    expect(parseInstagramEvents({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(parseInstagramEvents(null)).toEqual([]);
  });
  it('accepts message events in a changes envelope', () => {
    const event = { sender: { id: '456' }, recipient: { id: '123' }, timestamp: 1700000000000, message: { mid: 'm1', text: 'Hello' } };
    expect(parseInstagramEvents({ object: 'instagram', entry: [{ id: '123', changes: [{ field: 'messages', value: event }] }] })).toHaveLength(1);
  });
});
