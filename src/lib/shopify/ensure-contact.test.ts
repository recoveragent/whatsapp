import { describe, expect, it, vi } from 'vitest'

import {
  deleteConversationIfEmpty,
  hasActiveFlowRunForContact,
} from './ensure-contact'

function mockDb(handlers: {
  flowRunCount?: number
  flowRunError?: boolean
  msgCount?: number
  noteCount?: number
}) {
  const deleteConv = vi.fn().mockReturnThis()
  const eqConv = vi.fn().mockResolvedValue({ error: null })

  return {
    from: (table: string) => {
      if (table === 'flow_runs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue(
            handlers.flowRunError
              ? { count: null, error: { message: 'db error' } }
              : { count: handlers.flowRunCount ?? 0, error: null },
          ),
        }
      }
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            count: handlers.msgCount ?? 0,
            error: null,
          }),
        }
      }
      if (table === 'conversation_private_notes') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            count: handlers.noteCount ?? 0,
            error: null,
          }),
        }
      }
      if (table === 'conversations') {
        return { delete: deleteConv, eq: eqConv }
      }
      throw new Error(`unexpected table ${table}`)
    },
    deleteConv,
  }
}

describe('hasActiveFlowRunForContact', () => {
  it('returns true when an active run exists', async () => {
    const db = mockDb({ flowRunCount: 1 })
    await expect(
      hasActiveFlowRunForContact(db as never, 'acc-1', 'contact-1'),
    ).resolves.toBe(true)
  })

  it('returns false when no open runs', async () => {
    const db = mockDb({ flowRunCount: 0 })
    await expect(
      hasActiveFlowRunForContact(db as never, 'acc-1', 'contact-1'),
    ).resolves.toBe(false)
  })

  it('returns true on lookup error (do not delete mid-send)', async () => {
    const db = mockDb({ flowRunError: true })
    await expect(
      hasActiveFlowRunForContact(db as never, 'acc-1', 'contact-1'),
    ).resolves.toBe(true)
  })
})

describe('deleteConversationIfEmpty', () => {
  it('skips delete while a flow run is active for the contact', async () => {
    const db = mockDb({ flowRunCount: 1, msgCount: 0 })
    await deleteConversationIfEmpty(db as never, 'conv-1', {
      accountId: 'acc-1',
      contactId: 'contact-1',
    })
    expect(db.deleteConv).not.toHaveBeenCalled()
  })

  it('deletes empty conversation when no active flow run', async () => {
    const db = mockDb({ flowRunCount: 0, msgCount: 0, noteCount: 0 })
    await deleteConversationIfEmpty(db as never, 'conv-1', {
      accountId: 'acc-1',
      contactId: 'contact-1',
    })
    expect(db.deleteConv).toHaveBeenCalled()
  })
})
