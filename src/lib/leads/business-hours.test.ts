import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CALL_WINDOW,
  nextCallSlot,
  parseHmToMinutes,
} from './business-hours'

/** Instant at which Asia/Kolkata shows this wall clock (no DST). */
function ist(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 30) * 60 * 1000)
}

describe('parseHmToMinutes', () => {
  it('parses 10:00 and 19:00', () => {
    expect(parseHmToMinutes('10:00')).toBe(10 * 60)
    expect(parseHmToMinutes('19:00:00')).toBe(19 * 60)
  })
})

describe('nextCallSlot', () => {
  it('returns the same instant inside Mon–Sat 10:00–19:00 IST', () => {
    // Thursday 20 Aug 2026 14:00 IST
    const from = ist(2026, 8, 20, 14, 0)
    expect(nextCallSlot(from, DEFAULT_CALL_WINDOW).getTime()).toBe(from.getTime())
  })

  it('rolls to 10:00 IST the same day when before hours', () => {
    const from = ist(2026, 8, 20, 8, 15)
    expect(nextCallSlot(from).getTime()).toBe(ist(2026, 8, 20, 10, 0).getTime())
  })

  it('rolls to next weekday 10:00 IST after 19:00', () => {
    const from = ist(2026, 8, 20, 21, 0)
    expect(nextCallSlot(from).getTime()).toBe(ist(2026, 8, 21, 10, 0).getTime())
  })

  it('skips Sunday to Monday 10:00 IST', () => {
    const from = ist(2026, 8, 16, 15, 0)
    expect(nextCallSlot(from).getTime()).toBe(ist(2026, 8, 17, 10, 0).getTime())
  })

  it('skips Saturday evening to Monday 10:00 IST', () => {
    const from = ist(2026, 8, 22, 20, 0)
    expect(nextCallSlot(from).getTime()).toBe(ist(2026, 8, 24, 10, 0).getTime())
  })
})
