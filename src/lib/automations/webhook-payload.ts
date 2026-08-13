/**
 * Extract values from inbound webhook JSON bodies using dot-paths or
 * `{{trigger.field}}` syntax (matching common WhatsApp API tooling).
 */

/** Normalize a mapping path: `{{trigger.phone}}` → `phone`. */
export function normalizePayloadPath(path: string): string {
  const trimmed = path.trim()
  const m = trimmed.match(/^\{\{\s*trigger\.([\w.]+)\s*\}\}$/)
  if (m) return m[1]
  return trimmed
}

/** Read a nested value from an object using dot notation (supports `0` array indexes). */
export function extractByPath(payload: unknown, path: string): unknown {
  const normalized = normalizePayloadPath(path)
  if (!normalized) return undefined
  const parts = normalized.split('.').filter(Boolean)
  let cur: unknown = payload
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    if (Array.isArray(cur)) {
      const idx = Number(part)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined
      cur = cur[idx]
      continue
    }
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

const FALLBACK_TIMEZONE_PATHS = [
  'payload.attendees.0.timeZone',
  'attendees.0.timeZone',
  'payload.organizer.timeZone',
  'organizer.timeZone',
]

/** Resolve a display timezone from an explicit path or common Cal.com fields. */
export function resolveWebhookTimeZone(
  payload: unknown,
  timezonePath?: string | null,
): string | undefined {
  const paths = [
    ...(timezonePath?.trim() ? [timezonePath.trim()] : []),
    ...FALLBACK_TIMEZONE_PATHS,
  ]
  for (const path of paths) {
    const raw = extractByPath(payload, path)
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return undefined
}

/**
 * Turn ISO datetimes into a WhatsApp-friendly string, e.g.
 * `2026-08-14T04:30:00Z` + Asia/Calcutta → `14 Aug 2026, 10:00 am`.
 */
export function formatWebhookScalar(
  value: unknown,
  opts?: { timeZone?: string },
): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!ISO_DATETIME_RE.test(trimmed)) return value
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return value

  const formatOpts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      ...formatOpts,
      ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-GB', formatOpts).format(date)
  }
}

export interface BuildVarsOptions {
  /** IANA timezone for formatting ISO datetime fields. */
  timeZone?: string
}

/** Scalar values from the payload become template vars. */
export function buildVarsFromPayload(
  payload: unknown,
  variableMappings: Record<string, string> = {},
  opts?: BuildVarsOptions,
): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  const timeZone =
    opts?.timeZone ?? resolveWebhookTimeZone(payload) ?? undefined

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (v !== null && typeof v !== 'object') {
        vars[k] = formatWebhookScalar(v, { timeZone })
      }
    }
  }

  for (const [varName, path] of Object.entries(variableMappings)) {
    const val = extractByPath(payload, path)
    if (val !== undefined && val !== null && typeof val !== 'object') {
      vars[varName] = formatWebhookScalar(val, { timeZone })
    }
  }

  return vars
}

/** Flatten nested payload keys for the mapping preview UI. */
export function flattenPayloadKeys(payload: unknown, prefix = ''): string[] {
  const keys: string[] = []
  if (payload == null || typeof payload !== 'object') return keys
  if (Array.isArray(payload)) {
    if (!prefix) keys.push('[]')
    payload.forEach((item, i) => {
      const path = prefix ? `${prefix}.${i}` : String(i)
      keys.push(path)
      if (item != null && typeof item === 'object') {
        keys.push(...flattenPayloadKeys(item, path))
      }
    })
    return keys
  }
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    keys.push(path)
    if (v != null && typeof v === 'object') {
      keys.push(...flattenPayloadKeys(v, path))
    }
  }
  return keys
}
