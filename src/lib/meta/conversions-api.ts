import crypto from 'crypto'

import { CRM_LEAD_EVENT_SOURCE } from '@/lib/meta/attribution'
import { META_API_VERSION } from '@/lib/whatsapp/meta-api'

const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/** Events Meta accepts for action_source = business_messaging (WhatsApp). */
export const BUSINESS_MESSAGING_EVENTS = [
  'LeadSubmitted',
  'QualifiedLead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'CartAbandoned',
  'RatingProvided',
  'ReviewProvided',
] as const

export type BusinessMessagingEventName =
  (typeof BUSINESS_MESSAGING_EVENTS)[number]

export interface MetaConversionEventInput {
  eventName: BusinessMessagingEventName
  eventTime?: number
  eventId: string
  wabaId: string
  ctwaClid: string
  phone?: string | null
  email?: string | null
  customData?: Record<string, unknown>
}

export interface CrmConversionLeadEventInput {
  eventName: string
  eventTime?: number
  eventId: string
  leadId?: string | null
  phone?: string | null
  email?: string | null
  customData?: Record<string, unknown>
}

export interface MetaConversionSendResult {
  ok: boolean
  eventId?: string
  error?: string
  fbtraceId?: string
}

interface MetaEventsResponse {
  events_received?: number
  messages?: string[]
  fbtrace_id?: string
  error?: {
    message?: string
    fbtrace_id?: string
  }
}

export function hashMetaUserData(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

export function normalizePhoneForMeta(phone: string): string {
  return phone.replace(/\D/g, '')
}

export function buildBusinessMessagingEvent(
  input: MetaConversionEventInput,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {
    whatsapp_business_account_id: input.wabaId,
    ctwa_clid: input.ctwaClid,
  }

  if (input.phone) {
    const digits = normalizePhoneForMeta(input.phone)
    if (digits) userData.ph = [hashMetaUserData(digits)]
  }
  if (input.email) {
    const email = input.email.trim()
    if (email) userData.em = [hashMetaUserData(email)]
  }

  return {
    event_name: input.eventName,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: userData,
    ...(input.customData && Object.keys(input.customData).length > 0
      ? { custom_data: input.customData }
      : {}),
  }
}

export function buildCrmConversionLeadEvent(
  input: CrmConversionLeadEventInput,
): Record<string, unknown> {
  const userData: Record<string, unknown> = {}

  if (input.leadId?.trim()) {
    userData.lead_id = input.leadId.trim()
  }
  if (input.phone) {
    const digits = normalizePhoneForMeta(input.phone)
    if (digits) userData.ph = [hashMetaUserData(digits)]
  }
  if (input.email) {
    const email = input.email.trim()
    if (email) userData.em = [hashMetaUserData(email)]
  }

  const customData: Record<string, unknown> = {
    lead_event_source: CRM_LEAD_EVENT_SOURCE,
    event_source: 'crm',
    ...(input.customData ?? {}),
  }

  return {
    event_name: input.eventName,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: 'system_generated',
    user_data: userData,
    custom_data: customData,
  }
}

async function postConversionEvents(args: {
  datasetId: string
  accessToken: string
  partnerAgent?: string | null
  testEventCode?: string | null
  events: Record<string, unknown>[]
}): Promise<MetaConversionSendResult> {
  const payload: Record<string, unknown> = {
    data: args.events,
  }
  if (args.partnerAgent?.trim()) {
    payload.partner_agent = args.partnerAgent.trim()
  }
  if (args.testEventCode?.trim()) {
    payload.test_event_code = args.testEventCode.trim()
  }

  const url = `${META_API_BASE}/${encodeURIComponent(args.datasetId)}/events?access_token=${encodeURIComponent(args.accessToken)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = (await res.json()) as MetaEventsResponse
  if (!res.ok) {
    return {
      ok: false,
      error: body.error?.message ?? `Meta CAPI error (${res.status})`,
      fbtraceId: body.error?.fbtrace_id ?? body.fbtrace_id,
    }
  }

  return {
    ok: true,
    fbtraceId: body.fbtrace_id,
  }
}

export async function fetchWabaDatasetId(args: {
  wabaId: string
  accessToken: string
}): Promise<{ ok: true; datasetId: string } | { ok: false; error: string }> {
  const url = `${META_API_BASE}/${encodeURIComponent(args.wabaId)}/dataset?access_token=${encodeURIComponent(args.accessToken)}`
  const res = await fetch(url, { method: 'GET' })
  const body = (await res.json()) as { id?: string; error?: { message?: string } }
  if (!res.ok || !body.id) {
    return {
      ok: false,
      error: body.error?.message ?? `Failed to fetch dataset (${res.status})`,
    }
  }
  return { ok: true, datasetId: body.id }
}

export async function sendBusinessMessagingEvent(args: {
  datasetId: string
  accessToken: string
  partnerAgent?: string | null
  testEventCode?: string | null
  event: MetaConversionEventInput
}): Promise<MetaConversionSendResult> {
  const result = await postConversionEvents({
    datasetId: args.datasetId,
    accessToken: args.accessToken,
    partnerAgent: args.partnerAgent,
    testEventCode: args.testEventCode,
    events: [buildBusinessMessagingEvent(args.event)],
  })
  return result.ok
    ? { ...result, eventId: args.event.eventId }
    : result
}

export async function sendCrmConversionLeadEvent(args: {
  datasetId: string
  accessToken: string
  partnerAgent?: string | null
  testEventCode?: string | null
  event: CrmConversionLeadEventInput
}): Promise<MetaConversionSendResult> {
  const result = await postConversionEvents({
    datasetId: args.datasetId,
    accessToken: args.accessToken,
    partnerAgent: args.partnerAgent,
    testEventCode: args.testEventCode,
    events: [buildCrmConversionLeadEvent(args.event)],
  })
  return result.ok
    ? { ...result, eventId: args.event.eventId }
    : result
}
