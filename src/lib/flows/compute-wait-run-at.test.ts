import { describe, expect, it } from 'vitest'

import { computeWaitRunAt } from './extended-nodes'
import type { WaitNodeConfig } from './extended-nodes'

describe('computeWaitRunAt', () => {
  const now = Date.parse('2026-08-14T03:00:00.000Z')

  it('delay mode uses amount/unit from now', () => {
    const cfg: WaitNodeConfig = {
      mode: 'delay',
      amount: 1,
      unit: 'hours',
      next_node_key: 'next',
    }
    const result = computeWaitRunAt(cfg, {}, now)
    expect(result).toEqual({
      runAt: '2026-08-14T04:00:00.000Z',
      immediate: false,
    })
  })

  it('until mode schedules before meeting_start with offset', () => {
    const cfg: WaitNodeConfig = {
      mode: 'until',
      amount: 1,
      unit: 'hours',
      datetime_var: 'meeting_start',
      offset_minutes: -60,
      next_node_key: 'remind',
    }
    const result = computeWaitRunAt(
      cfg,
      { meeting_start_iso: '2026-08-14T04:30:00.000Z' },
      now,
    )
    expect(result).toEqual({
      runAt: '2026-08-14T03:30:00.000Z',
      immediate: false,
    })
  })

  it('until mode prefers _iso over formatted display var', () => {
    const cfg: WaitNodeConfig = {
      mode: 'until',
      amount: 1,
      unit: 'minutes',
      datetime_var: 'meeting_start',
      offset_minutes: -15,
      next_node_key: 'remind',
    }
    const result = computeWaitRunAt(
      cfg,
      {
        meeting_start: '14 Aug 2026, 10:00 am',
        meeting_start_iso: '2026-08-14T04:30:00.000Z',
      },
      now,
    )
    expect(result).toEqual({
      runAt: '2026-08-14T04:15:00.000Z',
      immediate: false,
    })
  })

  it('until mode continues immediately when target is past', () => {
    const cfg: WaitNodeConfig = {
      mode: 'until',
      amount: 1,
      unit: 'minutes',
      datetime_var: 'meeting_start',
      offset_minutes: -60,
      next_node_key: 'remind',
    }
    const result = computeWaitRunAt(
      cfg,
      { meeting_start_iso: '2026-08-14T03:30:00.000Z' },
      now,
    )
    expect(result).toEqual({
      runAt: '2026-08-14T03:00:00.000Z',
      immediate: true,
    })
  })

  it('until mode errors when datetime var missing', () => {
    const cfg: WaitNodeConfig = {
      mode: 'until',
      amount: 1,
      unit: 'minutes',
      datetime_var: 'meeting_start',
      offset_minutes: -60,
      next_node_key: 'remind',
    }
    expect(computeWaitRunAt(cfg, {}, now)).toEqual({
      error: 'datetime var "meeting_start" is missing',
    })
  })
})
