import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlowRunRow } from './types'

const h = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.dispatch }))

import { handOffRunToAiAgent } from './ai-agent-node'

function makeDb(lastMessage: { sender_type: string; created_at: string } | null) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          update: (payload: Record<string, unknown>) => {
            updates.push(payload)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: lastMessage, error: null }),
      }
      return chain
    },
  }
  return { db: db as unknown as SupabaseClient, updates }
}

const run = {
  id: 'run-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  contact_id: 'contact-1',
  conversation_id: 'conv-1',
} as FlowRunRow

beforeEach(() => h.dispatch.mockReset())

describe('handOffRunToAiAgent', () => {
  it('re-enables the agent, resets its budget and stores the goal', async () => {
    const { db, updates } = makeDb(null)
    await handOffRunToAiAgent(db, run, {}, '  Help them check out  ')
    expect(updates[0]).toEqual({
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_summary: null,
      ai_flow_goal: 'Help them check out',
    })
  })

  it('answers right away when the customer spoke last', async () => {
    const { db } = makeDb({ sender_type: 'customer', created_at: new Date().toISOString() })
    const out = await handOffRunToAiAgent(db, run, {}, '')
    expect(out.responded).toBe(true)
    expect(h.dispatch).toHaveBeenCalledWith({
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
    })
  })

  it('waits when the flow sent the last message (store-event flows)', async () => {
    const { db } = makeDb({ sender_type: 'bot', created_at: new Date().toISOString() })
    const out = await handOffRunToAiAgent(db, run, {}, '')
    expect(out.responded).toBe(false)
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('waits when the customer message is outside the 24h window', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const { db } = makeDb({ sender_type: 'customer', created_at: old })
    expect((await handOffRunToAiAgent(db, run, {}, '')).responded).toBe(false)
  })

  it('respects respond_now: false', async () => {
    const { db } = makeDb({ sender_type: 'customer', created_at: new Date().toISOString() })
    expect((await handOffRunToAiAgent(db, run, { respond_now: false }, '')).responded).toBe(false)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
