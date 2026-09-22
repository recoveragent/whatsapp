import { describe, expect, it, vi } from 'vitest'

import {
  ensureConversationForContact,
  pickCanonicalConversationId,
} from './ensure-conversation'

describe('pickCanonicalConversationId', () => {
  it('returns null for an empty list', async () => {
    await expect(pickCanonicalConversationId({} as never, [])).resolves.toBeNull()
  })

  it('returns the only candidate', async () => {
    await expect(
      pickCanonicalConversationId({} as never, [{ id: 'a', created_at: '2026-01-01' }]),
    ).resolves.toBe('a')
  })

  it('prefers the conversation with more messages', async () => {
    const db = {
      from: (table: string) => {
        expect(table).toBe('messages')
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { conversation_id: 'sparse' },
              { conversation_id: 'rich' },
              { conversation_id: 'rich' },
            ],
            error: null,
          }),
        }
      },
    }

    const picked = await pickCanonicalConversationId(db as never, [
      { id: 'sparse', created_at: '2026-01-02T00:00:00Z' },
      { id: 'rich', created_at: '2026-01-01T00:00:00Z' },
    ])

    expect(picked).toBe('rich')
  })
})

describe('ensureConversationForContact', () => {
  it('returns an existing canonical row without inserting', async () => {
    const insert = vi.fn()
    const chain: { eq: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
    }
    chain.eq
      .mockImplementationOnce(() => chain)
      .mockImplementationOnce(() => chain)
      .mockResolvedValueOnce({
        data: [{ id: 'conv-1', created_at: '2026-01-01' }],
        error: null,
      })

    const db = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue(chain),
            insert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const result = await ensureConversationForContact(
      db as never,
      'acc-1',
      'user-1',
      'contact-1',
      { whatsappConfigId: 'config-1' },
    )

    expect(result).toEqual({ id: 'conv-1' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('inserts when no row exists', async () => {
    const chain: { eq: ReturnType<typeof vi.fn> } = {
      eq: vi.fn(),
    }
    chain.eq
      .mockImplementationOnce(() => chain)
      .mockImplementationOnce(() => chain)
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })

    const db = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn().mockReturnValue(chain),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'new-conv' },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const result = await ensureConversationForContact(
      db as never,
      'acc-1',
      'user-1',
      'contact-1',
      { createStatus: 'closed', whatsappConfigId: 'config-1' },
    )

    expect(result).toEqual({ id: 'new-conv' })
  })

  it('re-selects after a unique-index race on insert', async () => {
    let selectCalls = 0
    const makeChain = (data: unknown[]) => {
      const chain: { eq: ReturnType<typeof vi.fn> } = {
        eq: vi.fn(),
      }
      chain.eq
        .mockImplementationOnce(() => chain)
        .mockImplementationOnce(() => chain)
        .mockResolvedValueOnce({ data, error: null })
      return chain
    }

    const db = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn().mockImplementation(() => {
              selectCalls += 1
              return selectCalls === 1
                ? makeChain([])
                : makeChain([{ id: 'raced-conv', created_at: '2026-01-01' }])
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const result = await ensureConversationForContact(
      db as never,
      'acc-1',
      'user-1',
      'contact-1',
      { whatsappConfigId: 'config-1' },
    )

    expect(result).toEqual({ id: 'raced-conv' })
    expect(selectCalls).toBe(2)
  })

  it('uses the account default WhatsApp number when none is supplied', async () => {
    const inserted = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-conv' }, error: null }),
      }),
    })
    const conversations = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
      insert: inserted,
    }
    const whatsappConfig = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'default-config' }, error: null }),
              }),
            }),
          }),
        }),
      }),
    }
    const db = {
      from: (table: string) => {
        if (table === 'conversations') return conversations
        if (table === 'whatsapp_config') return whatsappConfig
        throw new Error(`unexpected table ${table}`)
      },
    }

    await expect(
      ensureConversationForContact(db as never, 'acc-1', 'user-1', 'contact-1'),
    ).resolves.toEqual({ id: 'new-conv' })

    expect(inserted).toHaveBeenCalledWith(expect.objectContaining({
      whatsapp_config_id: 'default-config',
    }))
  })

  it('falls back to the oldest WhatsApp number before migration 105 is applied', async () => {
    const inserted = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'new-conv' }, error: null }),
      }),
    })
    const conversations = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
      insert: inserted,
    }
    const fallbackQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'legacy-config' }, error: null }),
          }),
        }),
      }),
    }
    const preferredQuery = {
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '42703', message: 'is_default is missing' },
              }),
            }),
          }),
        }),
      }),
    }
    const whatsappConfig = {
      select: vi.fn()
        .mockReturnValueOnce(preferredQuery)
        .mockReturnValueOnce(fallbackQuery),
    }
    const db = {
      from: (table: string) => {
        if (table === 'conversations') return conversations
        if (table === 'whatsapp_config') return whatsappConfig
        throw new Error(`unexpected table ${table}`)
      },
    }

    await ensureConversationForContact(db as never, 'acc-1', 'user-1', 'contact-1')

    expect(inserted).toHaveBeenCalledWith(expect.objectContaining({
      whatsapp_config_id: 'legacy-config',
    }))
  })
})
