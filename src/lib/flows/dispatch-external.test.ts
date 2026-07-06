import { beforeEach, describe, expect, it, vi } from 'vitest'

const { flowsQuery, contactQuery, startFlowForExternalEvent } = vi.hoisted(() => ({
  flowsQuery: vi.fn(),
  contactQuery: vi.fn(),
  startFlowForExternalEvent: vi.fn(),
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'contacts') return contactQuery()
      if (table === 'flows') return flowsQuery()
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }
    },
  }),
}))

vi.mock('./engine', () => ({ startFlowForExternalEvent }))
vi.mock('@/lib/shopify/ensure-contact', () => ({
  ensureShopifyContact: vi.fn(),
  ensureConversation: vi.fn(),
}))

import { runFlowsForTrigger } from './dispatch-external'
import type { FlowRow } from './types'

const baseFlow = (overrides: Partial<FlowRow> = {}): FlowRow =>
  ({
    id: 'flow-1',
    name: 'Order confirmation',
    account_id: 'acc-1',
    user_id: 'user-1',
    status: 'active',
    trigger_type: 'shopify_order_placed',
    trigger_config: { payment_status: 'any' },
    entry_node_id: 'start',
    ...overrides,
  }) as FlowRow

function mockFlowsChain(flows: FlowRow[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: FlowRow[] }) => void) =>
      resolve({ data: flows }),
  }
  flowsQuery.mockReturnValue(chain)
}

describe('runFlowsForTrigger — Shopify payment filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactQuery.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'contact-1' } }),
    })
    startFlowForExternalEvent.mockResolvedValue({
      ok: true,
      flow_run_id: 'run-1',
    })
  })

  it('starts flow when payment_status is any', async () => {
    mockFlowsChain([baseFlow({ trigger_config: { payment_status: 'any' } })])

    const outcome = await runFlowsForTrigger({
      accountId: 'acc-1',
      triggerType: 'shopify_order_placed',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      context: { vars: { payment_status: 'pending' } },
    })

    expect(outcome.started).toHaveLength(1)
    expect(outcome.skipped).toHaveLength(0)
  })

  it('skips flow when payment_status filter does not match (COD pending vs paid filter)', async () => {
    mockFlowsChain([baseFlow({ trigger_config: { payment_status: 'paid' } })])

    const outcome = await runFlowsForTrigger({
      accountId: 'acc-1',
      triggerType: 'shopify_order_placed',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      context: { vars: { payment_status: 'pending' } },
    })

    expect(outcome.started).toHaveLength(0)
    expect(outcome.skipped).toEqual([
      expect.objectContaining({
        reason: 'payment_status_mismatch',
        flow_name: 'Order confirmation',
      }),
    ])
  })

  it('starts flow when COD pending matches pending filter', async () => {
    mockFlowsChain([baseFlow({ trigger_config: { payment_status: 'pending' } })])

    const outcome = await runFlowsForTrigger({
      accountId: 'acc-1',
      triggerType: 'shopify_order_placed',
      contactId: 'contact-1',
      conversationId: 'conv-1',
      context: { vars: { payment_status: 'pending' } },
    })

    expect(outcome.started).toHaveLength(1)
  })
})
