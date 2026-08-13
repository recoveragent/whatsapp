import { describe, expect, it } from 'vitest'

import {
  extractBookingUid,
  extractWebhookTriggerEvent,
  isTriggerEventAllowed,
  normalizeAllowedTriggerEvents,
} from './booking-lifecycle'

describe('extractWebhookTriggerEvent', () => {
  it('reads Cal.com triggerEvent', () => {
    expect(
      extractWebhookTriggerEvent({ triggerEvent: 'BOOKING_CREATED' }),
    ).toBe('BOOKING_CREATED')
  })

  it('returns null when missing', () => {
    expect(extractWebhookTriggerEvent({ payload: {} })).toBeNull()
  })
})

describe('extractBookingUid', () => {
  it('reads nested Cal.com booking uid', () => {
    expect(
      extractBookingUid({
        triggerEvent: 'BOOKING_CREATED',
        payload: { uid: 'abc123' },
      }),
    ).toBe('abc123')
  })

  it('reads flat uid', () => {
    expect(extractBookingUid({ uid: 'flat-uid' })).toBe('flat-uid')
  })
})

describe('isTriggerEventAllowed', () => {
  it('allows all when list empty', () => {
    expect(isTriggerEventAllowed('BOOKING_CREATED', [])).toBe(true)
    expect(isTriggerEventAllowed('BOOKING_CREATED', null)).toBe(true)
    expect(isTriggerEventAllowed('BOOKING_CREATED', undefined)).toBe(true)
  })

  it('allows matching events only', () => {
    expect(
      isTriggerEventAllowed('BOOKING_CREATED', [
        'BOOKING_CREATED',
        'BOOKING_RESCHEDULED',
      ]),
    ).toBe(true)
    expect(
      isTriggerEventAllowed('BOOKING_CANCELLED', [
        'BOOKING_CREATED',
        'BOOKING_RESCHEDULED',
      ]),
    ).toBe(false)
  })

  it('does not block payloads without triggerEvent', () => {
    expect(isTriggerEventAllowed(null, ['BOOKING_CREATED'])).toBe(true)
  })
})

describe('normalizeAllowedTriggerEvents', () => {
  it('trims and drops empties', () => {
    expect(
      normalizeAllowedTriggerEvents([' BOOKING_CREATED ', '', 'PING']),
    ).toEqual(['BOOKING_CREATED', 'PING'])
  })

  it('returns undefined for empty input', () => {
    expect(normalizeAllowedTriggerEvents([])).toBeUndefined()
    expect(normalizeAllowedTriggerEvents(null)).toBeUndefined()
  })
})
