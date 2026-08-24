/**
 * WhatsApp Flow form helpers.
 *
 * Meta delivers form submissions (including CTWA ad lead forms) as
 * `interactive.type === 'nfm_reply'` with `nfm_reply.name === 'flow'`.
 * The structured answers live in `nfm_reply.response_json` as a flat
 * key/value map (or occasionally nested under `values`).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/
 */

/** CTWA / ad attribution on the customer's first inbound message. */
export interface WhatsAppReferral {
  source_type?: string
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

export interface ParsedFlowFormReply {
  /** Human-readable summary — from Meta body or formatted field list. */
  formatted: string
  /** Flat string field map extracted from response_json. */
  values: Record<string, string>
  /** Meta flow id when present in the payload. */
  flow_id?: string
  /** nfm_reply.name — usually "flow". */
  form_name?: string
}

export interface NfmFlowReplyInteractive {
  type: 'nfm_reply'
  nfm_reply?: {
    name?: string
    body?: string
    response_json?: string | Record<string, unknown>
  }
}

/** Keys Meta uses internally — not customer-facing form fields. */
const INTERNAL_RESPONSE_KEYS = new Set([
  'flow_token',
  'screen',
  'extension_message_response',
  'saved_address_id',
])

function asStringRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (INTERNAL_RESPONSE_KEYS.has(k)) continue
    if (typeof v === 'string' && v.trim()) {
      out[k] = v.trim()
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = String(v)
    } else if (typeof v === 'boolean') {
      out[k] = v ? 'true' : 'false'
    }
  }
  return out
}

function parseResponseJson(
  raw: string | Record<string, unknown> | undefined,
): { values: Record<string, string>; flow_id?: string } {
  if (!raw) return { values: {} }
  let parsed: Record<string, unknown>
  if (typeof raw === 'object') {
    parsed = raw
  } else {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { values: {} }
    }
  }

  const nestedValues = parsed.values
  const flatValues =
    nestedValues &&
    typeof nestedValues === 'object' &&
    !Array.isArray(nestedValues)
      ? asStringRecord(nestedValues)
      : asStringRecord(parsed)

  const flow_id =
    typeof parsed.flow_id === 'string' ? parsed.flow_id : undefined

  return { values: flatValues, flow_id }
}

/** Turn `full_name` / `Email_Address` into readable labels. */
export function formatFormFieldLabel(key: string): string {
  const cleaned = key
    .replace(/^screen_\d+_/i, '')
    .replace(/_\d+$/, '')
    .replace(/_/g, ' ')
    .trim()
  if (!cleaned) return key
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** Build a multi-line summary when Meta omits nfm_reply.body. */
export function formatFlowFormValues(values: Record<string, string>): string {
  const entries = Object.entries(values).filter(([, v]) => v.trim())
  if (entries.length === 0) return ''
  return entries
    .map(([k, v]) => `${formatFormFieldLabel(k)}: ${v}`)
    .join('\n')
}

/**
 * Returns a ParsedFlowFormReply when `interactive` is a WhatsApp Flow
 * form submission; otherwise null (address forms are handled separately).
 */
export function parseFlowNfmReply(
  interactive: NfmFlowReplyInteractive | null | undefined,
): ParsedFlowFormReply | null {
  if (!interactive || interactive.type !== 'nfm_reply') return null
  const reply = interactive.nfm_reply
  if (!reply) return null

  // Address messages use a dedicated parser — never double-handle.
  if (reply.name === 'address_message') return null

  const isFlow =
    reply.name === 'flow' ||
    reply.name === 'form' ||
    (!reply.name && reply.response_json != null)

  if (!isFlow && reply.name) return null

  const { values, flow_id } = parseResponseJson(reply.response_json)
  const hasValues = Object.keys(values).length > 0

  if (!hasValues && !(typeof reply.body === 'string' && reply.body.trim())) {
    return null
  }

  const formatted =
    (typeof reply.body === 'string' && reply.body.trim() && reply.body !== 'Sent'
      ? reply.body.trim()
      : '') ||
    formatFlowFormValues(values) ||
    '[Form submitted]'

  return {
    formatted,
    values,
    flow_id,
    form_name: reply.name,
  }
}

/** Value stored under `flow_runs.vars[var_key]` after a send_flow capture. */
export function flowFormReplyToFlowVar(
  reply: ParsedFlowFormReply,
): Record<string, unknown> {
  return {
    formatted: reply.formatted,
    ...reply.values,
    ...(reply.flow_id ? { flow_id: reply.flow_id } : {}),
  }
}

/** Map common lead-form field names onto contact profile columns. */
export function contactUpdatesFromFormValues(
  values: Record<string, string>,
): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {}

  const name =
    values.full_name?.trim() ||
    values.name?.trim() ||
    [values.first_name, values.last_name].filter(Boolean).join(' ').trim() ||
    values.customer_name?.trim()
  if (name) out.name = name

  const email =
    values.email?.trim() ||
    values.email_address?.trim() ||
    values.e_mail?.trim()
  if (email && email.includes('@')) out.email = email

  return out
}

export function normalizeReferral(
  raw: Record<string, unknown> | undefined,
): WhatsAppReferral | null {
  if (!raw || typeof raw !== 'object') return null
  const pick = (k: keyof WhatsAppReferral) => {
    const v = raw[k]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const referral: WhatsAppReferral = {
    source_type: pick('source_type'),
    source_id: pick('source_id'),
    source_url: pick('source_url'),
    headline: pick('headline'),
    body: pick('body'),
    media_type: pick('media_type'),
    image_url: pick('image_url'),
    video_url: pick('video_url'),
    thumbnail_url: pick('thumbnail_url'),
    ctwa_clid: pick('ctwa_clid'),
  }
  const hasData = Object.values(referral).some(Boolean)
  return hasData ? referral : null
}
