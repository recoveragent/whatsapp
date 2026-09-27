import { describe, expect, it, vi } from 'vitest'

import {
  ensureFlowOutboundPersisted,
  reconcileRecentFlowOutboundMessages,
  repairMissingFlowPromptForConversation,
} from './backfill-outbound-prompt'

describe('repairMissingFlowPromptForConversation', () => {
  it('returns empty result when there are no flow runs to scan', async () => {
    const db = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'bot-1' } }),
            order: vi.fn().mockReturnThis(),
          }
        }
        if (table === 'flow_runs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        if (table === 'automation_logs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [] }),
          }
        }
        throw new Error(`unexpected ${table}`)
      },
    }

    const result = await repairMissingFlowPromptForConversation({
      db: db as never,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
    })

    expect(result).toEqual({ repaired_count: 0, message_ids: [] })
  })
})

describe('ensureFlowOutboundPersisted', () => {
  it('no-ops when the WAMID already exists', async () => {
    const insert = vi.fn()
    const db = {
      from: () => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' } }),
        insert,
      }),
    }

    const id = await ensureFlowOutboundPersisted({
      db: db as never,
      accountId: 'acc-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      metaMessageId: 'wamid.exists',
      eventPayload: { content_text: 'Hi' },
    })

    expect(id).toBe('existing')
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserts from the event payload when the row is missing', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    let call = 0
    const db = {
      from: () => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () => {
          call += 1
          if (call === 1) return { data: null }
          return { data: { id: 'new-msg' } }
        }),
        insert,
      }),
    }

    const id = await ensureFlowOutboundPersisted({
      db: db as never,
      accountId: 'acc-1',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      metaMessageId: 'wamid.new',
      eventPayload: {
        node_type: 'send_template',
        template_name: 'order_confirm',
        content_text: 'Your order is received',
      },
    })

    expect(insert).toHaveBeenCalledTimes(1)
    expect(id).toBe('new-msg')
  })
})

describe('reconcileRecentFlowOutboundMessages', () => {
  it('rebuilds a missing flow message from its recorded Meta send event', async () => {
    let inserted = false
    const inserts: Record<string, unknown>[] = []
    const db = {
      from: (table: string) => {
        if (table === 'flow_runs') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'run-1',
                  account_id: 'acc-1',
                  user_id: 'user-1',
                  contact_id: 'contact-1',
                  conversation_id: 'conv-1',
                  vars: {},
                },
              ],
              error: null,
            }),
          }
          return chain
        }
        if (table === 'flow_run_events') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  created_at: '2026-09-27T03:53:33.710Z',
                  payload: {
                    node_type: 'send_template',
                    whatsapp_message_id: 'wamid.missing',
                    template_name: 'order_confirmation',
                    content_text: 'Your order is confirmed',
                  },
                },
              ],
              error: null,
            }),
          }
          return chain
        }
        if (table === 'messages') {
          const chain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockImplementation(async () => ({
              data: inserted ? { id: 'message-1' } : null,
              error: null,
            })),
            insert: vi.fn().mockImplementation(async (row) => {
              inserts.push(row as Record<string, unknown>)
              inserted = true
              return { error: null }
            }),
          }
          return chain
        }
        throw new Error(`unexpected ${table}`)
      },
    }

    const result = await reconcileRecentFlowOutboundMessages({ db: db as never })

    expect(result).toEqual({ scanned: 1, repaired_count: 1, unresolved_count: 0 })
    expect(inserts).toEqual([
      expect.objectContaining({
        conversation_id: 'conv-1',
        message_id: 'wamid.missing',
        content_text: 'Your order is confirmed',
      }),
    ])
  })
})
