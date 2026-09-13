import { describe, expect, it, vi } from 'vitest'

import {
  ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_DEFAULT,
  clampSkipRecentOrderDays,
  contactHasRecentShopifyOrder,
  isAbandonedCheckoutFlowTrigger,
  resolveSkipRecentOrderDays,
} from './abandoned-checkout-skip-recent-order'

describe('abandoned checkout skip recent order config', () => {
  it('recognizes both abandonment triggers', () => {
    expect(isAbandonedCheckoutFlowTrigger('shopify_checkout_abandoned')).toBe(true)
    expect(isAbandonedCheckoutFlowTrigger('shopify_checkout_app_abandoned')).toBe(true)
    expect(isAbandonedCheckoutFlowTrigger('shopify_order_placed')).toBe(false)
  })

  it('returns null when disabled', () => {
    expect(resolveSkipRecentOrderDays({})).toBeNull()
    expect(
      resolveSkipRecentOrderDays({ skip_recent_order_enabled: false, skip_recent_order_days: 7 }),
    ).toBeNull()
  })

  it('defaults days when enabled without a value', () => {
    expect(resolveSkipRecentOrderDays({ skip_recent_order_enabled: true })).toBe(
      ABANDONED_CHECKOUT_SKIP_RECENT_ORDER_DAYS_DEFAULT,
    )
  })

  it('clamps configured days', () => {
    expect(clampSkipRecentOrderDays(0)).toBe(1)
    expect(clampSkipRecentOrderDays(999)).toBe(365)
    expect(resolveSkipRecentOrderDays({ skip_recent_order_enabled: true, skip_recent_order_days: 14 })).toBe(
      14,
    )
  })
})

describe('contactHasRecentShopifyOrder', () => {
  it('matches by contact_id', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'order-1' }, error: null })
    const db = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle,
      }),
    }

    const result = await contactHasRecentShopifyOrder(db as never, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      phone: null,
      withinDays: 30,
      nowMs: Date.parse('2026-03-01T00:00:00.000Z'),
    })

    expect(result).toBe(true)
    expect(db.from).toHaveBeenCalledWith('shopify_orders')
  })

  it('returns false when no orders match', async () => {
    let call = 0
    const db = {
      from: vi.fn().mockImplementation(() => {
        call += 1
        if (call === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          like: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }),
    }

    const result = await contactHasRecentShopifyOrder(db as never, {
      accountId: 'acc-1',
      contactId: 'contact-1',
      phone: '919876543210',
      withinDays: 30,
    })

    expect(result).toBe(false)
  })
})
