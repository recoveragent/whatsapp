import type { SupabaseClient } from '@supabase/supabase-js'

import { accountIsLeadGen } from '@/lib/auth/brand-accounts'
import type { ExitReason } from '@/lib/leads/types'
import { decrypt } from '@/lib/whatsapp/encryption'

import {
  type ContactMetaAttribution,
  hasCtwaAttribution,
  hasInstantFormAttribution,
} from './attribution'
import {
  sendBusinessMessagingEvent,
  sendCrmConversionLeadEvent,
  fetchWabaDatasetId,
  type BusinessMessagingEventName,
} from './conversions-api'

export type LeadQualitySignal = 'replied' | 'instant_form_enrolled' | ExitReason

export interface MetaConversionsConfigRow {
  account_id: string
  enabled: boolean
  dataset_id: string | null
  crm_dataset_id: string | null
  test_event_code: string | null
  partner_agent: string
  send_on_replied: boolean
  send_on_qualified: boolean
  send_on_not_interested: boolean
  send_on_wrong_number: boolean
  send_on_instant_form_lead: boolean
}

interface WhatsAppCredentials {
  wabaId: string
  accessToken: string
}

interface ContactRow {
  phone: string | null
  email: string | null
  referral: ContactMetaAttribution | null
}

function isSignalEnabled(
  signal: LeadQualitySignal,
  config: MetaConversionsConfigRow,
): boolean {
  switch (signal) {
    case 'replied':
      return config.send_on_replied
    case 'meeting_booked':
      return config.send_on_qualified
    case 'not_interested':
      return config.send_on_not_interested
    case 'wrong_number':
      return config.send_on_wrong_number
    case 'instant_form_enrolled':
      return config.send_on_instant_form_lead
    default:
      return false
  }
}

function ctwaEventForSignal(
  signal: LeadQualitySignal,
): BusinessMessagingEventName | null {
  switch (signal) {
    case 'replied':
    case 'instant_form_enrolled':
      return 'LeadSubmitted'
    case 'meeting_booked':
      return 'QualifiedLead'
    case 'not_interested':
    case 'wrong_number':
      // Negative quality — Meta has no dedicated event; send LeadSubmitted with value 0.
      return 'LeadSubmitted'
    default:
      return null
  }
}

function crmEventNameForSignal(signal: LeadQualitySignal): string | null {
  switch (signal) {
    case 'instant_form_enrolled':
      return 'New Lead'
    case 'replied':
      return 'Contacted'
    case 'meeting_booked':
      return 'Qualified'
    case 'not_interested':
      return 'Not Interested'
    case 'wrong_number':
      return 'Wrong Number'
    default:
      return null
  }
}

function triggerKey(contactId: string, signal: LeadQualitySignal): string {
  return `${contactId}:${signal}`
}

function eventIdFromKey(key: string): string {
  return key.replace(/:/g, '-')
}

function buildCtwaCustomData(
  signal: LeadQualitySignal,
  attr: ContactMetaAttribution,
): Record<string, unknown> {
  const customData: Record<string, unknown> = { lead_signal: signal }
  if (attr.source_id) customData.ad_id = attr.source_id
  if (attr.headline) customData.content_name = attr.headline

  if (signal === 'not_interested' || signal === 'wrong_number') {
    customData.lead_quality = 'negative'
    customData.crm_outcome = signal
    customData.value = 0
  }

  return customData
}

function buildCrmCustomData(
  signal: LeadQualitySignal,
  attr: ContactMetaAttribution,
): Record<string, unknown> {
  const customData: Record<string, unknown> = { lead_signal: signal }
  if (attr.ad_id) customData.ad_id = attr.ad_id
  if (attr.form_id) customData.form_id = attr.form_id
  if (attr.campaign_name) customData.campaign_name = attr.campaign_name
  if (attr.ad_name) customData.ad_name = attr.ad_name
  return customData
}

async function loadWhatsAppCredentials(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppCredentials | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('waba_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (!data?.waba_id || !data.access_token) return null

  try {
    return {
      wabaId: data.waba_id as string,
      accessToken: decrypt(data.access_token as string),
    }
  } catch (err) {
    console.error('[meta-capi] decrypt token failed:', err)
    return null
  }
}

async function resolveMessagingDatasetId(
  db: SupabaseClient,
  config: MetaConversionsConfigRow,
  creds: WhatsAppCredentials,
): Promise<string | null> {
  if (config.dataset_id?.trim()) return config.dataset_id.trim()

  const fetched = await fetchWabaDatasetId({
    wabaId: creds.wabaId,
    accessToken: creds.accessToken,
  })
  if (!fetched.ok) {
    console.error('[meta-capi] dataset fetch failed:', fetched.error)
    return null
  }

  await db
    .from('meta_conversions_config')
    .update({ dataset_id: fetched.datasetId })
    .eq('account_id', config.account_id)

  return fetched.datasetId
}

function resolveCrmDatasetId(config: MetaConversionsConfigRow): string | null {
  return config.crm_dataset_id?.trim() || null
}

async function logConversionAttempt(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    triggerKey: string
    eventName: string
    channel: 'ctwa' | 'crm' | 'none'
    status: 'sent' | 'skipped' | 'failed'
    skipReason?: string
    metaEventId?: string
    errorMessage?: string
    payload?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await db.from('meta_conversion_events').insert({
    account_id: args.accountId,
    contact_id: args.contactId,
    trigger_key: args.triggerKey,
    event_name: args.eventName,
    status: args.status,
    skip_reason: args.skipReason ?? null,
    meta_event_id: args.metaEventId ?? null,
    error_message: args.errorMessage ?? null,
    payload: {
      ...(args.payload ?? {}),
      channel: args.channel,
    },
  })

  if (error && !error.message.includes('duplicate key')) {
    console.error('[meta-capi] log insert failed:', error.message)
  }
}

async function alreadyHandled(
  db: SupabaseClient,
  accountId: string,
  key: string,
): Promise<boolean> {
  const { data } = await db
    .from('meta_conversion_events')
    .select('id')
    .eq('account_id', accountId)
    .eq('trigger_key', key)
    .maybeSingle()
  return Boolean(data)
}

async function loadContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ContactRow | null> {
  const { data } = await db
    .from('contacts')
    .select('phone, email, referral')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data) return null
  return {
    phone: (data.phone as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    referral: (data.referral as ContactMetaAttribution | null) ?? null,
  }
}

async function sendCtwaEvent(args: {
  db: SupabaseClient
  config: MetaConversionsConfigRow
  creds: WhatsAppCredentials
  contact: ContactRow
  contactId: string
  accountId: string
  signal: LeadQualitySignal
  key: string
  eventName: BusinessMessagingEventName
  attr: ContactMetaAttribution
}): Promise<void> {
  const datasetId = await resolveMessagingDatasetId(
    args.db,
    args.config,
    args.creds,
  )
  if (!datasetId) {
    await logConversionAttempt(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      triggerKey: args.key,
      eventName: args.eventName,
      channel: 'ctwa',
      status: 'failed',
      errorMessage: 'Could not resolve Meta messaging dataset_id',
    })
    return
  }

  const eventId = eventIdFromKey(args.key)
  const result = await sendBusinessMessagingEvent({
    datasetId,
    accessToken: args.creds.accessToken,
    partnerAgent: args.config.partner_agent,
    testEventCode: args.config.test_event_code,
    event: {
      eventName: args.eventName,
      eventId,
      wabaId: args.creds.wabaId,
      ctwaClid: args.attr.ctwa_clid!.trim(),
      phone: args.contact.phone,
      email: args.contact.email,
      customData: buildCtwaCustomData(args.signal, args.attr),
    },
  })

  await logConversionAttempt(args.db, {
    accountId: args.accountId,
    contactId: args.contactId,
    triggerKey: args.key,
    eventName: args.eventName,
    channel: 'ctwa',
    status: result.ok ? 'sent' : 'failed',
    metaEventId: result.ok ? eventId : undefined,
    errorMessage: result.error,
    payload: { signal: args.signal, fbtrace_id: result.fbtraceId },
  })

  if (!result.ok) {
    console.error('[meta-capi] ctwa send failed:', result.error, result.fbtraceId)
  }
}

async function sendCrmEvent(args: {
  db: SupabaseClient
  config: MetaConversionsConfigRow
  creds: WhatsAppCredentials
  contact: ContactRow
  contactId: string
  accountId: string
  signal: LeadQualitySignal
  key: string
  eventName: string
  attr: ContactMetaAttribution
}): Promise<void> {
  const datasetId = resolveCrmDatasetId(args.config)
  if (!datasetId) {
    await logConversionAttempt(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      triggerKey: args.key,
      eventName: args.eventName,
      channel: 'crm',
      status: 'skipped',
      skipReason: 'no_crm_dataset_id',
    })
    return
  }

  const leadId = args.attr.meta_lead_id?.trim() || null
  const hasHashedMatch =
    Boolean(args.contact.phone?.trim()) || Boolean(args.contact.email?.trim())

  if (!leadId && !hasHashedMatch) {
    await logConversionAttempt(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      triggerKey: args.key,
      eventName: args.eventName,
      channel: 'crm',
      status: 'skipped',
      skipReason: 'no_lead_id_or_contact_match',
    })
    return
  }

  const eventId = eventIdFromKey(args.key)
  const result = await sendCrmConversionLeadEvent({
    datasetId,
    accessToken: args.creds.accessToken,
    partnerAgent: args.config.partner_agent,
    testEventCode: args.config.test_event_code,
    event: {
      eventName: args.eventName,
      eventId,
      leadId,
      phone: args.contact.phone,
      email: args.contact.email,
      customData: buildCrmCustomData(args.signal, args.attr),
    },
  })

  await logConversionAttempt(args.db, {
    accountId: args.accountId,
    contactId: args.contactId,
    triggerKey: args.key,
    eventName: args.eventName,
    channel: 'crm',
    status: result.ok ? 'sent' : 'failed',
    metaEventId: result.ok ? eventId : undefined,
    errorMessage: result.error,
    payload: { signal: args.signal, fbtrace_id: result.fbtraceId, lead_id: leadId },
  })

  if (!result.ok) {
    console.error('[meta-capi] crm send failed:', result.error, result.fbtraceId)
  }
}

/**
 * Send lead quality to Meta via CTWA business-messaging CAPI and/or
 * Instant Form CRM Conversion Leads CAPI.
 */
export async function emitLeadQualityEvent(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  signal: LeadQualitySignal
}): Promise<void> {
  if (!(await accountIsLeadGen(args.db, args.accountId))) return

  const key = triggerKey(args.contactId, args.signal)
  const ctwaKey = `${key}:ctwa`
  const crmKey = `${key}:crm`

  // Legacy rows used bare `key` before dual-channel support.
  if (await alreadyHandled(args.db, args.accountId, key)) return

  const { data: config } = await args.db
    .from('meta_conversions_config')
    .select('*')
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (!config?.enabled) return

  const typedConfig = config as MetaConversionsConfigRow
  if (!isSignalEnabled(args.signal, typedConfig)) return

  const contact = await loadContact(args.db, args.accountId, args.contactId)
  if (!contact) return

  const attr = contact.referral
  const creds = await loadWhatsAppCredentials(args.db, args.accountId)

  if (!creds) {
    await logConversionAttempt(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      triggerKey: key,
      eventName: crmEventNameForSignal(args.signal) ?? args.signal,
      channel: 'none',
      status: 'skipped',
      skipReason: 'whatsapp_not_configured',
    })
    return
  }

  const canCtwa =
    hasCtwaAttribution(attr) &&
    args.signal !== 'instant_form_enrolled' &&
    Boolean(ctwaEventForSignal(args.signal)) &&
    !(await alreadyHandled(args.db, args.accountId, ctwaKey))

  const canCrm =
    hasInstantFormAttribution(attr) &&
    !(await alreadyHandled(args.db, args.accountId, crmKey))

  if (canCtwa && attr?.ctwa_clid) {
    const eventName = ctwaEventForSignal(args.signal)!
    await sendCtwaEvent({
      db: args.db,
      config: typedConfig,
      creds,
      contact,
      contactId: args.contactId,
      accountId: args.accountId,
      signal: args.signal,
      key: ctwaKey,
      eventName,
      attr,
    })
  }

  if (canCrm) {
    const crmEventName = crmEventNameForSignal(args.signal)
    if (crmEventName) {
      await sendCrmEvent({
        db: args.db,
        config: typedConfig,
        creds,
        contact,
        contactId: args.contactId,
        accountId: args.accountId,
        signal: args.signal,
        key: crmKey,
        eventName: crmEventName,
        attr: attr ?? { attribution_source: 'instant_form' },
      })
    }
  }

  if (!canCtwa && !canCrm) {
    if (await alreadyHandled(args.db, args.accountId, crmKey)) return
    if (await alreadyHandled(args.db, args.accountId, ctwaKey)) return

    await logConversionAttempt(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      triggerKey: key,
      eventName: args.signal,
      channel: 'none',
      status: 'skipped',
      skipReason: 'no_attribution',
    })
  }
}
