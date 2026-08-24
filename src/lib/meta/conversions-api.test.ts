import { describe, expect, it } from 'vitest'

import {
  buildBusinessMessagingEvent,
  buildCrmConversionLeadEvent,
  hashMetaUserData,
  normalizePhoneForMeta,
} from './conversions-api'
import {
  extractSheetMetaAttribution,
  normalizeMetaLeadId,
} from './sheet-attribution'

describe('normalizePhoneForMeta', () => {
  it('strips non-digits', () => {
    expect(normalizePhoneForMeta('+91 98765 43210')).toBe('919876543210')
    expect(normalizePhoneForMeta('p:16315551234')).toBe('16315551234')
  })
})

describe('normalizeMetaLeadId', () => {
  it('strips Meta sheet prefixes and validates length', () => {
    expect(normalizeMetaLeadId('l:1234567890123456')).toBe('1234567890123456')
    expect(normalizeMetaLeadId('l:1707')).toBeNull()
  })
})

describe('extractSheetMetaAttribution', () => {
  it('maps Facebook lead export columns', () => {
    const attr = extractSheetMetaAttribution({
      id: 'l:1234567890123456',
      created_time: '2026-01-01',
      ad_id: 'ag:1202',
      ad_name: 'Summer promo',
      form_id: '987654',
      campaign_name: 'Lead gen Q1',
      phone_number: 'p:+919800000001',
    })

    expect(attr).toMatchObject({
      attribution_source: 'instant_form',
      meta_lead_id: '1234567890123456',
      ad_id: '1202',
      form_id: '987654',
      ad_name: 'Summer promo',
      campaign_name: 'Lead gen Q1',
      created_time: '2026-01-01',
    })
  })
})

describe('buildBusinessMessagingEvent', () => {
  it('builds CTWA business messaging payload', () => {
    const event = buildBusinessMessagingEvent({
      eventName: 'LeadSubmitted',
      eventId: 'contact-1-replied',
      eventTime: 1_700_000_000,
      wabaId: '123456789',
      ctwaClid: 'ctwa-abc',
      phone: '+919876543210',
      email: 'Lead@Example.com',
      customData: { lead_quality: 'negative', value: 0 },
    })

    expect(event).toMatchObject({
      event_name: 'LeadSubmitted',
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
    })

    const userData = event.user_data as Record<string, unknown>
    expect(userData.ctwa_clid).toBe('ctwa-abc')
    expect(userData.ph).toEqual([hashMetaUserData('919876543210')])
  })
})

describe('buildCrmConversionLeadEvent', () => {
  it('builds Instant Form CRM payload', () => {
    const event = buildCrmConversionLeadEvent({
      eventName: 'Not Interested',
      eventId: 'contact-1-not-interested-crm',
      leadId: '1234567890123456',
      phone: '+919876543210',
      customData: { lead_signal: 'not_interested' },
    })

    expect(event).toMatchObject({
      event_name: 'Not Interested',
      action_source: 'system_generated',
    })

    const userData = event.user_data as Record<string, unknown>
    expect(userData.lead_id).toBe('1234567890123456')
    const customData = event.custom_data as Record<string, unknown>
    expect(customData.event_source).toBe('crm')
    expect(customData.lead_event_source).toBe('wacrm')
  })
})
