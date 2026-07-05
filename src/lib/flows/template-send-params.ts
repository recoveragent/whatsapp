/**
 * Map flow/automation template variable keys to Meta send-time params.
 *
 * Keys in the config `variables` record:
 *   "1", "2", …       → body {{N}}
 *   "header_1"        → text header {{1}}
 *   "button_0", …     → URL / COPY_CODE button overrides
 */

import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'

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

  const buttonParams: Record<number, string> = {}
  for (const [k, v] of Object.entries(variables)) {
    const m = k.match(/^button_(\d+)$/)
    if (m) buttonParams[Number(m[1])] = interpolate(String(v))
  }

  return {
    body: body.length > 0 ? body : undefined,
    headerText,
    buttonParams:
      Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
  }
}

/** Legacy body-only array → SendTimeParams.body */
export function bodyParamsToSendTimeParams(params: string[]): SendTimeParams {
  return params.length > 0 ? { body: params } : {}
}
