/**
 * Meta attribution stored on contacts.referral (JSONB).
 * CTWA fields come from the WhatsApp webhook; Instant Form fields from Google Sheets.
 */
export interface ContactMetaAttribution {
  /** CTWA click id — required for business_messaging CAPI. */
  ctwa_clid?: string
  source_type?: string
  /** CTWA ad id or Instant Form ad_id. */
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  /** Meta Instant Form lead id (15–17 digits after normalizing sheet prefixes). */
  meta_lead_id?: string
  form_id?: string
  ad_id?: string
  ad_name?: string
  campaign_name?: string
  created_time?: string
  /** Where attribution was captured. */
  attribution_source?: 'ctwa' | 'instant_form'
}

export const CRM_LEAD_EVENT_SOURCE = 'wacrm'

export function hasCtwaAttribution(
  attr: ContactMetaAttribution | null | undefined,
): boolean {
  return Boolean(attr?.ctwa_clid?.trim())
}

export function hasInstantFormAttribution(
  attr: ContactMetaAttribution | null | undefined,
): boolean {
  if (!attr) return false
  if (attr.meta_lead_id?.trim()) return true
  if (attr.attribution_source === 'instant_form') return true
  return Boolean(attr.form_id?.trim() || attr.ad_id?.trim())
}

export function mergeMetaAttribution(
  existing: ContactMetaAttribution | null | undefined,
  incoming: ContactMetaAttribution,
): ContactMetaAttribution {
  const merged: ContactMetaAttribution = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(incoming) as [
    keyof ContactMetaAttribution,
    string | undefined,
  ][]) {
    if (typeof value === 'string' && value.trim() && !merged[key]) {
      merged[key] = value.trim()
    }
  }
  return merged
}
