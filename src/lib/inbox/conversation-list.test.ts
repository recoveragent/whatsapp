import { describe, expect, it } from 'vitest';

import {
  getInboxActivityAt,
  getNextInboxConversation,
  isOpenInboxConversation,
  matchesInboxSearch,
  shouldShowInInboxList,
  sortInboxConversations,
} from './conversation-list';

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

describe('matchesInboxSearch', () => {
  const conv = {
    contact: { name: 'Akhilesh Kanodia', phone: '919903620741' },
    last_message_text: 'Your order #TTF9867 is received.',
  };

  it('matches name and phone substrings', () => {
    expect(matchesInboxSearch(conv, 'akhilesh')).toBe(true);
    expect(matchesInboxSearch(conv, '919903620741')).toBe(true);
  });

  it('matches domestic phone digits without country code', () => {
    expect(matchesInboxSearch(conv, '9903620741')).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(matchesInboxSearch(conv, '   ')).toBe(true);
  });
});

const sampleConversations = [
  {
    id: 'a',
    status: 'open' as const,
    unread_count: 1,
    last_message_at: '2026-08-21T09:00:00Z',
    contact: { name: 'Alice', phone: '9111111111' },
    last_message_text: 'Hi',
  },
  {
    id: 'b',
    status: 'open' as const,
    unread_count: 0,
    last_message_at: '2026-08-21T08:00:00Z',
    contact: { name: 'Bob', phone: '9222222222' },
    last_message_text: 'Hello',
  },
  {
    id: 'c',
    status: 'open' as const,
    unread_count: 0,
    last_message_at: '2026-08-21T07:00:00Z',
    contact: { name: 'Carol', phone: '9333333333' },
    last_message_text: 'Hey',
  },
];

describe('getInboxActivityAt', () => {
  it('prefers the newer of last message and updated timestamps', () => {
    expect(
      getInboxActivityAt({
        last_message_at: '2026-08-21T08:00:00Z',
        updated_at: '2026-08-21T10:00:00Z',
      }),
    ).toBe('2026-08-21T10:00:00Z');
    expect(
      getInboxActivityAt({
        last_message_at: '2026-08-21T10:00:00Z',
        updated_at: '2026-08-21T08:00:00Z',
      }),
    ).toBe('2026-08-21T10:00:00Z');
  });

  it('falls back to whichever timestamp is present', () => {
    expect(
      getInboxActivityAt({ last_message_at: '2026-08-21T08:00:00Z' }),
    ).toBe('2026-08-21T08:00:00Z');
    expect(getInboxActivityAt({ updated_at: '2026-08-21T09:00:00Z' })).toBe(
      '2026-08-21T09:00:00Z',
    );
  });
});

describe('sortInboxConversations', () => {
  it('orders by newest last message first by default', () => {
    const sorted = sortInboxConversations(sampleConversations, 'newest');
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('ranks a recently closed thread above older messages', () => {
    const sorted = sortInboxConversations(
      [
        {
          id: 'old-msg',
          status: 'closed' as const,
          last_message_at: '2026-08-21T09:00:00Z',
          updated_at: '2026-08-21T09:00:00Z',
        },
        {
          id: 'closed-now',
          status: 'closed' as const,
          last_message_at: '2026-08-21T07:00:00Z',
          updated_at: '2026-08-21T11:00:00Z',
        },
      ],
      'newest',
    );
    expect(sorted.map((c) => c.id)).toEqual(['closed-now', 'old-msg']);
  });

  it('orders by oldest last message first when requested', () => {
    const sorted = sortInboxConversations(sampleConversations, 'oldest');
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('getNextInboxConversation', () => {
  it('prefers the unread row below the closed thread', () => {
    const conversations = [
      { ...sampleConversations[0], id: 'a', unread_count: 0 },
      { ...sampleConversations[1], id: 'b', unread_count: 1 },
      { ...sampleConversations[2], id: 'c', unread_count: 0 },
    ];
    expect(
      getNextInboxConversation(conversations, 'a', 'open'),
    ).toMatchObject({ id: 'b' });
  });

  it('skips read rows below and falls back to an unread row above', () => {
    const conversations = [
      { ...sampleConversations[0], id: 'a', unread_count: 1 },
      { ...sampleConversations[1], id: 'b', unread_count: 0 },
      { ...sampleConversations[2], id: 'c', unread_count: 0 },
    ];
    expect(
      getNextInboxConversation(conversations, 'c', 'open'),
    ).toMatchObject({ id: 'a' });
  });

  it('returns null when no unread threads remain', () => {
    const conversations = sampleConversations.map((c) => ({
      ...c,
      unread_count: 0,
    }));
    expect(
      getNextInboxConversation(conversations, 'b', 'open'),
    ).toBeNull();
  });

  it('returns null when closing the only visible thread', () => {
    expect(
      getNextInboxConversation([sampleConversations[0]], 'a', 'open'),
    ).toBeNull();
  });
});
