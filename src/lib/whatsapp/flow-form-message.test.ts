import { describe, expect, it } from 'vitest'
import {
  contactUpdatesFromFormValues,
  formatFlowFormValues,
  formatFormFieldLabel,
  flowFormReplyToFlowVar,
  normalizeReferral,
  parseFlowNfmReply,
} from './flow-form-message'

describe('parseFlowNfmReply', () => {
  it('parses a CTWA ad lead form with flat response_json', () => {
    const parsed = parseFlowNfmReply({
      type: 'nfm_reply',
      nfm_reply: {
        name: 'flow',
        body: 'Sent',
        response_json: JSON.stringify({
          full_name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '+919876543210',
        }),
      },
    })
    expect(parsed).toEqual({
      formatted: 'Full name: Jane Doe\nEmail: jane@example.com\nPhone: +919876543210',
      values: {
        full_name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+919876543210',
      },
      flow_id: undefined,
      form_name: 'flow',
    })
  })

  it('uses Meta body when it is more than the generic Sent placeholder', () => {
    const parsed = parseFlowNfmReply({
      type: 'nfm_reply',
      nfm_reply: {
        name: 'flow',
        body: 'Thanks — we received your details.',
        response_json: JSON.stringify({ interest: 'Premium plan' }),
      },
    })
    expect(parsed?.formatted).toBe('Thanks — we received your details.')
  })

  it('parses object response_json', () => {
    const parsed = parseFlowNfmReply({
      type: 'nfm_reply',
      nfm_reply: {
        name: 'flow',
        response_json: {
          flow_id: '123456789',
          company: 'Acme Corp',
        },
      },
    })
    expect(parsed?.flow_id).toBe('123456789')
    expect(parsed?.values.company).toBe('Acme Corp')
  })

  it('returns null for address_message replies', () => {
    expect(
      parseFlowNfmReply({
        type: 'nfm_reply',
        nfm_reply: {
          name: 'address_message',
          response_json: JSON.stringify({ values: { city: 'Mumbai' } }),
        },
      }),
    ).toBeNull()
  })

  it('returns null for empty submissions', () => {
    expect(
      parseFlowNfmReply({
        type: 'nfm_reply',
        nfm_reply: { name: 'flow', response_json: '{}' },
      }),
    ).toBeNull()
  })
})

describe('formatFormFieldLabel', () => {
  it('humanizes snake_case keys', () => {
    expect(formatFormFieldLabel('full_name')).toBe('Full name')
    expect(formatFormFieldLabel('screen_0_Email_0')).toBe('Email')
  })
})

describe('formatFlowFormValues', () => {
  it('joins fields with labels', () => {
    expect(
      formatFlowFormValues({ city: 'Mumbai', budget: '50000' }),
    ).toBe('City: Mumbai\nBudget: 50000')
  })
})

describe('flowFormReplyToFlowVar', () => {
  it('includes formatted plus individual fields', () => {
    expect(
      flowFormReplyToFlowVar({
        formatted: 'Jane Doe',
        values: { full_name: 'Jane Doe', email: 'j@x.com' },
      }),
    ).toEqual({
      formatted: 'Jane Doe',
      full_name: 'Jane Doe',
      email: 'j@x.com',
    })
  })
})

describe('contactUpdatesFromFormValues', () => {
  it('maps name and email from common keys', () => {
    expect(
      contactUpdatesFromFormValues({
        full_name: 'Jane Doe',
        email: 'jane@example.com',
      }),
    ).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
  })
})

describe('normalizeReferral', () => {
  it('extracts CTWA ad referral fields', () => {
    expect(
      normalizeReferral({
        source_type: 'ad',
        source_id: '120212345678901234',
        headline: 'Summer sale',
        ctwa_clid: 'abc123',
      }),
    ).toEqual({
      source_type: 'ad',
      source_id: '120212345678901234',
      source_url: undefined,
      headline: 'Summer sale',
      body: undefined,
      media_type: undefined,
      image_url: undefined,
      video_url: undefined,
      thumbnail_url: undefined,
      ctwa_clid: 'abc123',
    })
  })
})
