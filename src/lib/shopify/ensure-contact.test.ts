import { describe, expect, it, vi } from 'vitest'

import {
  deleteConversationIfEmpty,
  hasActiveFlowRunForContact,
} from './ensure-contact'

function mockDb(handlers: {
  flowRunCount?: number
  flowRunError?: boolean
  activeRunOnConvCount?: number
  msgCount?: number
  noteCount?: number
  orphanedMetaSend?: boolean
  orphanedMetaSendError?: boolean
}) {
  const deleteConv = vi.fn().mockReturnThis()
  const eqConv = vi.fn().mockResolvedValue({ error: null })

  return {
    from: (table: string) => {
      if (table === 'flow_runs') {
        return {
          select: vi.fn((_: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count) {
              const countResult = handlers.flowRunError
                ? { count: null, error: { message: 'db error' } }
                : { count: handlers.flowRunCount ?? 0, error: null }
              const convCountResult = {
                count: handlers.activeRunOnConvCount ?? 0,
                error: null,
              }
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue(countResult),
                  })),
                  in: vi.fn().mockResolvedValue(convCountResult),
                })),
              }
            }
            return {
              eq: vi.fn((col: string) => {
                if (col === 'account_id') {
                  return {
                    eq: vi.fn((col2: string) => {
                      if (col2 !== 'contact_id') {
                        throw new Error(`unexpected eq ${col2}`)
                      }
                      return {
                        in: vi.fn().mockResolvedValue(
                          handlers.flowRunError
                            ? { count: null, error: { message: 'db error' } }
                            : { count: handlers.flowRunCount ?? 0, error: null },
                        ),
                      }
                    }),
                  }
                }
                if (col === 'conversation_id') {
                  return Promise.resolve({
                    data: handlers.orphanedMetaSend ? [{ id: 'run-1' }] : [],
                    error: handlers.orphanedMetaSendError
                      ? { message: 'events error' }
                      : null,
                  })
                }
                if (col === 'contact_id') {
                  return {
                    is: vi.fn().mockResolvedValue({
                      data: handlers.orphanedMetaSend ? [{ id: 'run-orphan' }] : [],
                      error: null,
                    }),
                  }
                }
                throw new Error(`unexpected eq ${col}`)
              }),
            }
          }),
        }
      }
      if (table === 'flow_run_events') {
        let pendingEventType: string | null = null
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, value?: string) => {
            if (col === 'event_type') pendingEventType = value ?? null
            return Promise.resolve({
              data:
                handlers.orphanedMetaSend && pendingEventType === 'error'
                  ? [{ payload: { detail: 'sent to Meta but DB insert failed: fk' } }]
                  : handlers.orphanedMetaSend && pendingEventType === 'message_sent'
                    ? [
                        {
                          payload: {
                            whatsapp_message_id: 'wamid.orphan',
                          },
                        },
                      ]
                    : [],
              error: handlers.orphanedMetaSendError
                ? { message: 'events error' }
                : null,
            })
          }),
        }
      }
      if (table === 'messages') {
        return {
          select: vi.fn((cols?: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count) {
              return {
                eq: vi.fn().mockResolvedValue({
                  count: handlers.msgCount ?? 0,
                  error: null,
                }),
              }
            }
            return {
              eq: vi.fn().mockResolvedValue({
                count: handlers.msgCount ?? 0,
                error: null,
              }),
              in: vi.fn().mockResolvedValue({
                data: handlers.orphanedMetaSend ? [] : [{ message_id: 'wamid.orphan' }],
                error: null,
              }),
            }
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

  it('skips delete when a flow logged Meta send without DB message', async () => {
    const db = mockDb({ flowRunCount: 0, msgCount: 0, orphanedMetaSend: true })
    await deleteConversationIfEmpty(db as never, 'conv-1', {
      accountId: 'acc-1',
      contactId: 'contact-1',
    })
    expect(db.deleteConv).not.toHaveBeenCalled()
  })
})
