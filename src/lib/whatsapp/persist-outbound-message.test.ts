import { describe, expect, it, vi } from 'vitest'

import {
  insertOutboundMessage,
  isMetaSentDbInsertFailed,
} from './persist-outbound-message'

describe('isMetaSentDbInsertFailed', () => {
  it('detects the Meta-sent DB failure marker', () => {
    expect(
      isMetaSentDbInsertFailed('sent to Meta but DB insert failed: fk'),
    ).toBe(true)
    expect(isMetaSentDbInsertFailed('network timeout')).toBe(false)
  })
})

describe('insertOutboundMessage', () => {
  it('retries until insert succeeds', async () => {
    const insert = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: 'transient' } })
      .mockResolvedValueOnce({ error: null })

    const db = {
      from: () => ({ insert }),
    }

    await insertOutboundMessage(db as never, { conversation_id: 'conv-1' })
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('throws the Meta-sent marker after retries are exhausted', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'fk violation' } })
    const db = {
      from: () => ({ insert }),
    }

    await expect(
      insertOutboundMessage(db as never, { conversation_id: 'conv-1' }),
    ).rejects.toThrow('sent to Meta but DB insert failed: fk violation')
    expect(insert).toHaveBeenCalledTimes(3)
  })
})
