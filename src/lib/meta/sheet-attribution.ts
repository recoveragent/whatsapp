import type { ContactMetaAttribution } from './attribution'

const LEAD_ID_KEYS = ['id', 'lead_id', 'leadgen_id', 'leadgen id'] as const
const AD_ID_KEYS = ['ad_id', 'ad id'] as const
const FORM_ID_KEYS = ['form_id', 'form id'] as const
const AD_NAME_KEYS = ['ad_name', 'ad name'] as const
const CAMPAIGN_KEYS = ['campaign_name', 'campaign name', 'campaign'] as const
const CREATED_KEYS = ['created_time', 'created time', 'created'] as const

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, ' ')
}

function pickColumn(
  row: Record<string, string>,
  candidates: readonly string[],
): string {
  const normalized = new Map<string, string>()
  for (const [k, v] of Object.entries(row)) {
    normalized.set(normalizeKey(k), (v ?? '').trim())
  }
  for (const candidate of candidates) {
    const value = normalized.get(normalizeKey(candidate))
    if (value) return value
  }
  return ''
}

/**
 * Meta sheet exports prefix ids — e.g. `l:1234567890123456`, `ag:1202`.
 * Returns digits-only lead id when valid for Conversion Leads CAPI.
 */
export function normalizeMetaLeadId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withoutPrefix = trimmed.replace(/^[a-z]+:/i, '').trim()
  if (/^\d{15,17}$/.test(withoutPrefix)) return withoutPrefix

  // Some exports use shorter internal ids — keep digits if present.
  const digits = withoutPrefix.replace(/\D/g, '')
  if (digits.length >= 15 && digits.length <= 17) return digits

  return null
}

export function normalizeMetaResourceId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.replace(/^[a-z]+:/i, '').trim() || null
}

/**
 * Extract Instant Form attribution from a Google Sheets lead-export row.
 */
export function extractSheetMetaAttribution(
  rowObj: Record<string, string>,
): ContactMetaAttribution | null {
  const rawLeadId = pickColumn(rowObj, LEAD_ID_KEYS)
  const metaLeadId = rawLeadId ? normalizeMetaLeadId(rawLeadId) : null
  const adIdRaw = pickColumn(rowObj, AD_ID_KEYS)
  const formIdRaw = pickColumn(rowObj, FORM_ID_KEYS)
  const adName = pickColumn(rowObj, AD_NAME_KEYS)
  const campaignName = pickColumn(rowObj, CAMPAIGN_KEYS)
  const createdTime = pickColumn(rowObj, CREATED_KEYS)

  const adId = adIdRaw ? normalizeMetaResourceId(adIdRaw) : null
  const formId = formIdRaw ? normalizeMetaResourceId(formIdRaw) : null

  if (!metaLeadId && !adId && !formId && !adName && !campaignName) {
    return null
  }

  const attr: ContactMetaAttribution = {
    attribution_source: 'instant_form',
  }
  if (metaLeadId) attr.meta_lead_id = metaLeadId
  if (adId) {
    attr.ad_id = adId
    attr.source_id = adId
  }
  if (formId) attr.form_id = formId
  if (adName) attr.ad_name = adName
  if (campaignName) attr.campaign_name = campaignName
  if (createdTime) attr.created_time = createdTime
  if (rawLeadId && !metaLeadId) {
    // Preserve raw id for debugging when normalization fails.
    attr.body = rawLeadId
  }

  return attr
}
