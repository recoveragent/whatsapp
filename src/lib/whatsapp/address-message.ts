/**
 * WhatsApp Address Messages helpers.
 *
 * Meta's interactive `address_message` type (India + Singapore only)
 * lets businesses collect a structured shipping address without
 * asking field-by-field in chat. The customer fills a native form;
 * the reply arrives as `interactive.type === 'nfm_reply'` with
 * `nfm_reply.name === 'address_message'`.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/api/messages/address-messages/
 */

/** Countries Meta currently supports for Address Messages. */
export type AddressMessageCountry = 'IN' | 'SG'

export const ADDRESS_MESSAGE_COUNTRIES: AddressMessageCountry[] = ['IN', 'SG']

/**
 * Shared field names used in `values` / `saved_addresses` / replies.
 * Not every field applies to every country — see Meta's table.
 */
export interface AddressMessageValues {
  name?: string
  phone_number?: string
  /** India PIN */
  in_pin_code?: string
  /** Singapore postcode */
  sg_post_code?: string
  house_number?: string
  floor_number?: string
  tower_number?: string
  building_name?: string
  address?: string
  landmark_area?: string
  /** Singapore unit */
  unit_number?: string
  city?: string
  state?: string
}

export interface AddressSavedAddress {
  id: string
  value: AddressMessageValues
}

/**
 * Structured payload we persist on inbound address replies
 * (`messages.content_payload`) and stash in flow_runs.vars.
 */
export interface ParsedAddressReply {
  /** Human-readable multi-line summary from Meta (`nfm_reply.body`). */
  formatted: string
  values: AddressMessageValues
  saved_address_id?: string
}

/**
 * Raw shape of `messages[].interactive` when the customer submits
 * an address form. `response_json` is usually a JSON *string* on
 * Cloud API webhooks (sometimes already an object on older samples).
 */
export interface NfmAddressReplyInteractive {
  type: 'nfm_reply'
  nfm_reply?: {
    name?: string
    body?: string
    response_json?: string | Record<string, unknown>
  }
}

interface ResponseJsonShape {
  saved_address_id?: string
  values?: AddressMessageValues
}

function asStringRecord(input: unknown): AddressMessageValues {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: AddressMessageValues = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      ;(out as Record<string, string>)[k] = v
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      ;(out as Record<string, string>)[k] = String(v)
    }
  }
  return out
}

function parseResponseJson(
  raw: string | Record<string, unknown> | undefined,
): ResponseJsonShape {
  if (!raw) return {}
  if (typeof raw === 'object') {
    return {
      saved_address_id:
        typeof raw.saved_address_id === 'string'
          ? raw.saved_address_id
          : undefined,
      values: asStringRecord(raw.values),
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      saved_address_id:
        typeof parsed.saved_address_id === 'string'
          ? parsed.saved_address_id
          : undefined,
      values: asStringRecord(parsed.values),
    }
  } catch {
    return {}
  }
}

/**
 * Format structured address values into a readable single block when
 * Meta does not supply `nfm_reply.body`.
 */
export function formatAddressValues(values: AddressMessageValues): string {
  const lines: string[] = []
  if (values.name) lines.push(values.name)
  if (values.phone_number) lines.push(values.phone_number)

  const detailParts = [
    values.in_pin_code || values.sg_post_code,
    values.house_number,
    values.floor_number,
    values.tower_number,
    values.unit_number,
    values.building_name,
    values.address,
    values.landmark_area,
    values.city,
    values.state,
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

  if (detailParts.length > 0) lines.push(detailParts.join(', '))
  return lines.join('\n').trim()
}

/**
 * Returns a ParsedAddressReply when `interactive` is an address
 * nfm_reply; otherwise null.
 */
export function parseAddressNfmReply(
  interactive: NfmAddressReplyInteractive | null | undefined,
): ParsedAddressReply | null {
  if (!interactive || interactive.type !== 'nfm_reply') return null
  const reply = interactive.nfm_reply
  if (!reply) return null
  // Meta sets name to "address_message" for address forms. Accept
  // missing name only when response_json clearly has address values
  // so we don't mis-handle other future NFM types.
  const parsed = parseResponseJson(reply.response_json)
  const isAddress =
    reply.name === 'address_message' ||
    (Object.keys(parsed.values ?? {}).length > 0 && !reply.name)
  if (!isAddress && reply.name && reply.name !== 'address_message') {
    return null
  }
  if (!isAddress && !reply.body) return null

  const values = parsed.values ?? {}
  const formatted =
    (typeof reply.body === 'string' && reply.body.trim()) ||
    formatAddressValues(values) ||
    '[Address submitted]'

  return {
    formatted,
    values,
    saved_address_id: parsed.saved_address_id,
  }
}

/**
 * Value stored under `flow_runs.vars[var_key]` after a send_address
 * capture. `formatted` is what `{{vars.X}}` interpolates to.
 */
export function addressReplyToFlowVar(reply: ParsedAddressReply): Record<string, unknown> {
  return {
    formatted: reply.formatted,
    ...reply.values,
    ...(reply.saved_address_id
      ? { saved_address_id: reply.saved_address_id }
      : {}),
  }
}
