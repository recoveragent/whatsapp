/**
 * Map flow/automation template variable keys to Meta send-time params.
 *
 * Keys in the config `variables` record:
 *   "1", "2", …       → body {{N}}
 *   "header_1"        → text header {{1}}
 *   "header_media"    → IMAGE/VIDEO/DOCUMENT header media URL
 *   "button_0", …     → URL / COPY_CODE button overrides
 */

import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'

/** True when the flow maps header media via {{ vars.* }} instead of a static URL. */
export function isDynamicHeaderMediaMapping(value: string | undefined): boolean {
  const trimmed = value?.trim()
  return !!trimmed && trimmed.includes('{{')
}

export function buildSendTimeParamsFromVariables(
  variables: Record<string, string> | undefined,
  interpolate: (raw: string) => string,
): SendTimeParams {
  if (!variables) return {}

  const bodyKeys = Object.keys(variables)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))

  const body = bodyKeys.map((k) => interpolate(String(variables[k] ?? '')))

  const headerRaw = variables.header_1
  const headerText = headerRaw ? interpolate(String(headerRaw)) : undefined

  const headerMediaRaw = variables.header_media
  const headerMediaUrl = headerMediaRaw
    ? interpolate(String(headerMediaRaw)).trim() || undefined
    : undefined

  const buttonParams: Record<number, string> = {}
  for (const [k, v] of Object.entries(variables)) {
    const m = k.match(/^button_(\d+)$/)
    if (m) buttonParams[Number(m[1])] = interpolate(String(v))
  }

  return {
    body: body.length > 0 ? body : undefined,
    headerText,
    headerMediaUrl,
    headerMediaRequired: isDynamicHeaderMediaMapping(headerMediaRaw),
    buttonParams:
      Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
  }
}

/** Legacy body-only array → SendTimeParams.body */
export function bodyParamsToSendTimeParams(params: string[]): SendTimeParams {
  return params.length > 0 ? { body: params } : {}
}
