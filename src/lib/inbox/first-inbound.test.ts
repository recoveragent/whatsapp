import { describe, expect, it, vi } from 'vitest'

import { isFirstColdInboundMessage } from './first-inbound'

vi.mock('@/lib/inbox/ensure-conversation', () => ({
  findConversationsForContact: vi.fn(),
}))

import { findConversationsForContact } from '@/lib/inbox/ensure-conversation'

const mockedFindConversations = vi.mocked(findConversationsForContact)

function mockDb(counts: { customer?: number; outbound?: number }) {
  return {
    from: (table: string) => {
      expect(table).toBe('messages')
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockImplementation(function (this: { _outbound?: boolean }, ...args: unknown[]) {
          if (args[0] === 'content_type') this._outbound = true
          return this
        }),
        then(onFulfilled: (value: { count: number; error: null }) => unknown) {
          const count = this._outbound ? (counts.outbound ?? 0) : (counts.customer ?? 0)
          return Promise.resolve(onFulfilled({ count, error: null }))
        },
      }
    },
  }
}

describe('isFirstColdInboundMessage', () => {
  it('returns true when the contact has no prior customer or outbound messages', async () => {
    mockedFindConversations.mockResolvedValue([{ id: 'conv-1' }])

    await expect(
      isFirstColdInboundMessage(mockDb({ customer: 0, outbound: 0 }) as never, 'acct', 'contact'),
    ).resolves.toBe(true)
  })

  it('returns false when the contact already sent an inbound message', async () => {
    mockedFindConversations.mockResolvedValue([{ id: 'conv-1' }])

    await expect(
      isFirstColdInboundMessage(mockDb({ customer: 2, outbound: 0 }) as never, 'acct', 'contact'),
    ).resolves.toBe(false)
  })

  it('returns false when we already sent an outbound message', async () => {
    mockedFindConversations.mockResolvedValue([{ id: 'conv-1' }])

    await expect(
      isFirstColdInboundMessage(mockDb({ customer: 0, outbound: 1 }) as never, 'acct', 'contact'),
    ).resolves.toBe(false)
  })

  it('checks all conversation shells for the contact', async () => {
    mockedFindConversations.mockResolvedValue([
      { id: 'conv-shopify' },
      { id: 'conv-reply' },
    ])

    await expect(
      isFirstColdInboundMessage(mockDb({ customer: 0, outbound: 1 }) as never, 'acct', 'contact'),
    ).resolves.toBe(false)
  })
})
