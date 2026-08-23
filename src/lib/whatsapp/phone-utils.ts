/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Strip a domestic trunk `0` inserted immediately after the country code.
 * Meta's phone-variant retry sometimes lands on this shape (e.g. Indian
 * `9190361033460`) while WhatsApp `wa_id` values omit it (`919036103346`).
 * Persisting / matching on the canonical form keeps outbound Shopify sends
 * and inbound webhooks on the same contact + conversation.
 */
export function canonicalContactPhone(phone: string): string {
  const n = normalizePhone(phone)
  if (!n) return n

  // Already canonical — do not shorten via mistaken country-code splits.
  if (/^91[6-9]\d{9}$/.test(n)) return n

  const candidates = phoneVariants(n)
  const minLen = Math.min(n.length, ...candidates.map((v) => v.length))
  const shortest = candidates.filter((v) => v.length === minLen)
  if (shortest.length === 1) return shortest[0]!

  const inMobile = shortest.find((v) => /^91[6-9]\d{9}$/.test(v))
  if (inMobile) return inMobile

  return shortest[0]!
}

/** Last-8 suffixes used to pre-filter contacts in SQL lookups. */
export function contactLookupSuffixes(phone: string): string[] {
  const seen = new Set<string>()
  const add = (raw: string) => {
    const n = normalizePhone(raw)
    if (!n) return
    seen.add(n.length >= 8 ? n.slice(-8) : n)
  }

  add(phone)
  add(canonicalContactPhone(phone))
  for (const variant of phoneVariants(normalizePhone(phone))) {
    add(variant)
    add(canonicalContactPhone(variant))
  }

  return [...seen]
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true

  const c1 = canonicalContactPhone(n1)
  const c2 = canonicalContactPhone(n2)
  if (c1 === c2) return true

  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * After a Meta send succeeds via a phone-variant retry, store the canonical
 * contact phone (not the raw variant Meta accepted) so later inbound
 * webhooks resolve the same contact row.
 */
export function contactPhoneAfterSuccessfulSend(
  originalSanitized: string,
  workingPhone: string,
): string {
  return canonicalContactPhone(workingPhone || originalSanitized)
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
