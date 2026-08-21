import { describe, expect, it } from 'vitest';

import { isOpenInboxConversation, shouldShowInInboxList } from './conversation-list';

describe('shouldShowInInboxList', () => {
  it('hides threads that have never received a message', () => {
    expect(shouldShowInInboxList({ last_message_at: null })).toBe(false);
    expect(shouldShowInInboxList({ last_message_at: undefined })).toBe(false);
  });

  it('keeps threads with a last message timestamp', () => {
    expect(shouldShowInInboxList({ last_message_at: '2026-08-21T07:00:00Z' })).toBe(
      true,
    );
  });
});

describe('isOpenInboxConversation', () => {
  it('counts only open threads that belong in the inbox list', () => {
    expect(
      isOpenInboxConversation({
        status: 'open',
        last_message_at: '2026-08-21T07:00:00Z',
      }),
    ).toBe(true);
  });

  it('ignores open threads with no messages', () => {
    expect(isOpenInboxConversation({ status: 'open', last_message_at: null })).toBe(
      false,
    );
  });

  it('ignores closed and follow-up threads', () => {
    expect(
      isOpenInboxConversation({
        status: 'closed',
        last_message_at: '2026-08-21T07:00:00Z',
      }),
    ).toBe(false);
    expect(
      isOpenInboxConversation({
        status: 'followup',
        last_message_at: '2026-08-21T07:00:00Z',
      }),
    ).toBe(false);
  });
});
