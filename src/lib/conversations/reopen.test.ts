import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  insertConversationStatusMessage,
  resolveAgentDisplayName,
} from '@/lib/inbox/status-system-message'
import {
  reopenClosedConversation,
  reopenClosedConversationOnAgentReply,
} from './reopen'

vi.mock('@/lib/inbox/status-system-message', () => ({
  insertConversationStatusMessage: vi.fn(async () => null),
  resolveAgentDisplayName: vi.fn(async () => 'Priya'),
}))

/**
 * Regression cover for issue #409's "closed conversation lockout": an
 * inbound message bumped `unread_count` but never touched `status`, so a
 * closed thread accumulated unread customer messages while still reading
 * as resolved and staying out of the inbox's Open filter.
 */

interface Recorded {
  table: string
  payload: Record<string, unknown> | null
  filters: [string, unknown][]
}

/** Chainable stub shaped like the bit of postgrest this touches. */
function stubClient(error: { message: string } | null = null) {
  const calls: Recorded[] = []

  const client = {
    from(table: string) {
      const rec: Recorded = { table, payload: null, filters: [] }
      calls.push(rec)
      const builder = {
        update(payload: Record<string, unknown>) {
          rec.payload = payload
          return builder
        },
        eq(column: string, value: unknown) {
          rec.filters.push([column, value])
          return builder
        },
        then(onFulfilled: (v: { error: unknown }) => unknown) {
          return Promise.resolve({ error }).then(onFulfilled)
        },
      }
      return builder
    },
  }

  return { client: client as unknown as SupabaseClient, calls }
}

describe('reopenClosedConversation', () => {
  it('flips a closed conversation back to open', async () => {
    const { client, calls } = stubClient()

    const reopened = await reopenClosedConversation(client, {
      id: 'conv-1',
      status: 'closed',
    })

    expect(reopened).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('conversations')
    expect(calls[0].payload).toMatchObject({ status: 'open' })
    expect(calls[0].payload).toHaveProperty('updated_at')
  })

  it('guards the write on the row still being closed', async () => {
    // The caller read the row earlier in the request. Without this filter,
    // two concurrent inbound deliveries both holding a stale
    // `status: 'closed'` could write 'open' over an agent's re-close.
    const { client, calls } = stubClient()

    await reopenClosedConversation(client, { id: 'conv-1', status: 'closed' })

    expect(calls[0].filters).toEqual([
      ['id', 'conv-1'],
      ['status', 'closed'],
    ])
  })

  it.each(['open', 'pending'])(
    'issues no query for a %s conversation',
    async (status) => {
      const { client, calls } = stubClient()

      const reopened = await reopenClosedConversation(client, {
        id: 'conv-1',
        status,
      })

      expect(reopened).toBe(false)
      expect(calls).toEqual([])
    },
  )

  it('issues no query when status is missing', async () => {
    const { client, calls } = stubClient()

    expect(await reopenClosedConversation(client, { id: 'conv-1' })).toBe(false)
    expect(calls).toEqual([])
  })

  it('swallows a failed update so inbound processing continues', async () => {
    // Throwing here would abort the webhook and make Meta redeliver the
    // message — a worse outcome than a thread that stays closed.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = stubClient({ message: 'permission denied' })

    await expect(
      reopenClosedConversation(client, { id: 'conv-1', status: 'closed' }),
    ).resolves.toBe(false)

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('reopenClosedConversationOnAgentReply', () => {
  const insertMessage = vi.mocked(insertConversationStatusMessage)

  function stub(result: { data: { id: string }[] | null; error: unknown }) {
    const eq = vi.fn()
    const builder = {
      update: vi.fn(() => builder),
      eq: eq.mockImplementation(() => builder),
      select: vi.fn(async () => result),
    }
    const from = vi.fn(() => builder)
    return { db: { from } as unknown as SupabaseClient, from, builder }
  }

  beforeEach(() => {
    insertMessage.mockClear()
  })

  it('reopens a closed chat and logs who opened it', async () => {
    const { db, builder } = stub({ data: [{ id: 'conv-1' }], error: null })

    const reopened = await reopenClosedConversationOnAgentReply(
      db,
      { id: 'conv-1', status: 'closed' },
      'user-1',
    )

    expect(reopened).toBe(true)
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open' }),
    )
    expect(builder.eq).toHaveBeenCalledWith('status', 'closed')
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        status: 'open',
        actor: { kind: 'agent', name: 'Priya', userId: 'user-1' },
      }),
    )
  })

  it.each(['open', 'followup', 'pending'])('leaves a %s chat alone', async (status) => {
    const { db, from } = stub({ data: [], error: null })

    expect(
      await reopenClosedConversationOnAgentReply(db, { id: 'conv-1', status }, 'user-1'),
    ).toBe(false)
    expect(from).not.toHaveBeenCalled()
    expect(insertMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['another request reopened it first', { data: [], error: null }],
    ['the update fails', { data: null, error: { message: 'boom' } }],
  ])('logs nothing in the timeline when %s', async (_label, result) => {
    const { db } = stub(result)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(
      await reopenClosedConversationOnAgentReply(
        db,
        { id: 'conv-1', status: 'closed' },
        'user-1',
      ),
    ).toBe(false)
    expect(insertMessage).not.toHaveBeenCalled()
  })

  it('never throws once the message has been sent', async () => {
    const { db } = stub({ data: [{ id: 'conv-1' }], error: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(resolveAgentDisplayName).mockRejectedValueOnce(new Error('network'))

    await expect(
      reopenClosedConversationOnAgentReply(
        db,
        { id: 'conv-1', status: 'closed' },
        'user-1',
      ),
    ).resolves.toBe(false)
  })
})
