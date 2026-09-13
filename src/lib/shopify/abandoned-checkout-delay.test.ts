import { afterEach, describe, expect, it } from 'vitest'

import {
  ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT,
  isAbandonedCheckoutStale,
  resolveAbandonedCheckoutMaxAgeMs,
} from './abandoned-checkout-delay'

describe('abandoned checkout max age', () => {
  afterEach(() => {
    delete process.env.ABANDONED_CHECKOUT_MAX_AGE_HOURS
  })

  it('defaults to 24 hours', () => {
    expect(resolveAbandonedCheckoutMaxAgeMs()).toBe(
      ABANDONED_CHECKOUT_MAX_AGE_HOURS_DEFAULT * 60 * 60 * 1000,
    )
  })

  it('marks checkouts past the max age as stale', () => {
    const now = Date.parse('2026-09-13T12:00:00.000Z')
    const runAt = '2026-09-11T12:00:00.000Z'
    expect(isAbandonedCheckoutStale(runAt, now)).toBe(true)
  })

  it('keeps recent checkouts eligible', () => {
    const now = Date.parse('2026-09-13T12:00:00.000Z')
    const runAt = '2026-09-13T10:00:00.000Z'
    expect(isAbandonedCheckoutStale(runAt, now)).toBe(false)
  })
})
