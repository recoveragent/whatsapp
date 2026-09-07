import { describe, expect, it, vi } from 'vitest'

import {
  DUPLICATE_LEAD_STAGE_MOVE_REASON,
  createOrMoveDealForContact,
} from './create-or-move-deal'

function mockDb(handlers: {
  existingDeal?: { id: string; stage_id: string; notes: string | null; status: string } | null
  fromStageName?: string
  toStageName?: string
}) {
  const updates: Record<string, unknown>[] = []
  const stageEvents: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []

  const db = {
    from(table: string) {
      let stageLookupCount = 0
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (table === 'deals') {
            return { data: handlers.existingDeal ?? null, error: null }
          }
          if (table === 'pipeline_stages') {
            stageLookupCount += 1
            const name =
              stageLookupCount === 1
                ? (handlers.fromStageName ?? handlers.toStageName ?? 'Stage')
                : (handlers.toStageName ?? handlers.fromStageName ?? 'Stage')
            return { data: { name }, error: null }
          }
          return { data: null, error: null }
        },
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            if (table === 'deals') updates.push(payload)
            return { error: null }
          },
        }),
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              inserts.push(payload)
              return {
                data: { id: 'deal-new', created_at: '2026-01-01T00:00:00Z' },
                error: null,
              }
            },
          }),
        }),
      }
      return chain
    },
  }

  return {
    db: db as never,
    updates,
    inserts,
    stageEvents,
  }
}

vi.mock('@/lib/deals/stage-events', () => ({
  recordDealReceivedEvent: vi.fn(async (_db, args) => {
    return args
  }),
  recordDealStageMoveEvent: vi.fn(async (_db, args) => {
    return args
  }),
}))

describe('createOrMoveDealForContact', () => {
  it('creates a deal when none exists for the contact in the pipeline', async () => {
    const { db, inserts } = mockDb({ existingDeal: null, toStageName: 'New Lead' })
    const result = await createOrMoveDealForContact(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      pipelineId: 'pipe-1',
      stageId: 'stage-new',
      title: 'Amit',
      value: 0,
      currency: 'INR',
    })

    expect(result.created).toBe(true)
    expect(result.moved).toBe(false)
    expect(inserts).toHaveLength(1)
  })

  it('moves an existing open deal to the lead stage on duplicate submission', async () => {
    const { db, updates } = mockDb({
      existingDeal: {
        id: 'deal-1',
        stage_id: 'stage-qualified',
        notes: null,
        status: 'open',
      },
      fromStageName: 'Qualified',
      toStageName: 'New Lead',
    })

    const result = await createOrMoveDealForContact(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
      pipelineId: 'pipe-1',
      stageId: 'stage-new',
      title: 'Amit',
    })

    expect(result.created).toBe(false)
    expect(result.moved).toBe(true)
    expect(updates[0]?.stage_id).toBe('stage-new')
    expect(String(updates[0]?.notes)).toContain(DUPLICATE_LEAD_STAGE_MOVE_REASON)
  })
})
