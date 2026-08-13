import { describe, expect, it } from 'vitest'

import {
  extractByPath,
  flattenPayloadKeys,
  normalizePayloadPath,
} from './webhook-payload'

describe('normalizePayloadPath', () => {
  it('unwraps {{trigger.x}} syntax', () => {
    expect(normalizePayloadPath('{{trigger.phone}}')).toBe('phone')
  })
})

describe('extractByPath', () => {
  const sample = {
    payload: {
      attendees: [{ name: 'Jane', email: 'j@example.com', phoneNumber: '+15551212' }],
      responses: {
        attendeePhoneNumber: { label: 'phone_number', value: '+15559876' },
      },
    },
  }

  it('reads nested object fields', () => {
    expect(extractByPath(sample, 'payload.responses.attendeePhoneNumber.value')).toBe(
      '+15559876',
    )
  })

  it('reads array indexes', () => {
    expect(extractByPath(sample, 'payload.attendees.0.name')).toBe('Jane')
    expect(extractByPath(sample, 'payload.attendees.0.phoneNumber')).toBe('+15551212')
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
