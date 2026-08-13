import { describe, expect, it } from 'vitest'

import {
  buildVarsFromPayload,
  extractByPath,
  flattenPayloadKeys,
  formatWebhookScalar,
  normalizePayloadPath,
  resolveWebhookTimeZone,
} from './webhook-payload'

describe('normalizePayloadPath', () => {
  it('unwraps {{trigger.x}} syntax', () => {
    expect(normalizePayloadPath('{{trigger.phone}}')).toBe('phone')
  })
})

describe('extractByPath', () => {
  const sample = {
    payload: {
      attendees: [
        { name: 'Jane', email: 'j@example.com', phoneNumber: '+15551212' },
      ],
      responses: {
        attendeePhoneNumber: { label: 'phone_number', value: '+15559876' },
      },
    },
  }

  it('reads nested object fields', () => {
    expect(
      extractByPath(sample, 'payload.responses.attendeePhoneNumber.value'),
    ).toBe('+15559876')
  })

  it('reads array indexes', () => {
    expect(extractByPath(sample, 'payload.attendees.0.name')).toBe('Jane')
    expect(extractByPath(sample, 'payload.attendees.0.phoneNumber')).toBe(
      '+15551212',
    )
  })

  it('returns undefined for missing paths', () => {
    expect(extractByPath(sample, 'phone')).toBeUndefined()
    expect(extractByPath(sample, 'payload.attendees.9.name')).toBeUndefined()
  })
})

describe('flattenPayloadKeys', () => {
  it('includes array index paths', () => {
    const keys = flattenPayloadKeys({
      payload: { attendees: [{ name: 'A' }] },
    })
    expect(keys).toContain('payload.attendees.0')
    expect(keys).toContain('payload.attendees.0.name')
  })
})

describe('formatWebhookScalar', () => {
  it('formats ISO datetimes in the given timezone', () => {
    expect(
      formatWebhookScalar('2026-08-14T04:30:00.000Z', {
        timeZone: 'Asia/Calcutta',
      }),
    ).toBe('14 Aug 2026, 10:00 am')
  })

  it('leaves non-datetime strings unchanged', () => {
    expect(formatWebhookScalar('Recover Agent')).toBe('Recover Agent')
  })
})

describe('buildVarsFromPayload', () => {
  it('formats mapped ISO datetimes using Cal.com attendee timezone', () => {
    const vars = buildVarsFromPayload(
      {
        payload: {
          startTime: '2026-08-14T04:30:00.000Z',
          attendees: [{ timeZone: 'Asia/Calcutta' }],
        },
      },
      { meeting_time: 'payload.startTime' },
    )
    expect(vars.meeting_time).toBe('14 Aug 2026, 10:00 am')
  })
})

describe('resolveWebhookTimeZone', () => {
  it('prefers an explicit path', () => {
    expect(
      resolveWebhookTimeZone(
        {
          payload: {
            attendees: [{ timeZone: 'Asia/Calcutta' }],
            organizer: { timeZone: 'UTC' },
          },
        },
        'payload.organizer.timeZone',
      ),
    ).toBe('UTC')
  })
})
