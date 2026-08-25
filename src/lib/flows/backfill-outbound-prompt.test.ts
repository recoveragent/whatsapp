import { describe, expect, it, vi } from 'vitest'

import { repairMissingFlowPromptForConversation } from './backfill-outbound-prompt'

describe('repairMissingFlowPromptForConversation', () => {
  it('no-ops when the thread already has an outbound message', async () => {
    const insert = vi.fn()
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
            insert,
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

    expect(result).toBeNull()
    expect(insert).not.toHaveBeenCalled()
  })
})
