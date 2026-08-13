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

/** Scalar values from the payload become template vars. */
export function buildVarsFromPayload(
  payload: unknown,
  variableMappings: Record<string, string> = {},
): Record<string, unknown> {
  const vars: Record<string, unknown> = {}

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (v !== null && typeof v !== 'object') vars[k] = v
    }
  }

  for (const [varName, path] of Object.entries(variableMappings)) {
    const val = extractByPath(payload, path)
    if (val !== undefined && val !== null && typeof val !== 'object') {
      vars[varName] = val
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
