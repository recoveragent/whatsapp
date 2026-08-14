/**
 * Resolve {{ vars.* }}, {{ trigger.* }}, {{ message.text }}, bare {{name}},
 * and fallback forms like {{ vars.name | "there" }}.
 */

export function resolveTemplateVar(
  key: string,
  vars: Record<string, unknown>,
  messageText?: string,
): string | undefined {
  if (key === 'message.text') return messageText ?? ''

  let lookup = key
  const hadPrefix = key.startsWith('vars.') || key.startsWith('trigger.')
  if (key.startsWith('vars.')) lookup = key.slice(5)
  else if (key.startsWith('trigger.')) lookup = key.slice(8)

  if (lookup in vars) {
    const val = vars[lookup]
    return val === undefined || val === null ? '' : String(val)
  }
  if (hadPrefix) return ''
  if (key in vars) return String(vars[key] ?? '')
  return undefined
}

export function interpolateTemplateString(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string,
): string {
  if (!template) return ''

  const withFallback = template.replace(
    /\{\{\s*([\w.]+)\s*\|\s*(?:"([^"]*)"|'([^']*)')\s*\}\}/g,
    (match, key: string, dq: string | undefined, sq: string | undefined) => {
      const fallback = dq ?? sq ?? ''
      const resolved = resolveTemplateVar(key, vars, messageText)
      if (resolved !== undefined && resolved.trim() !== '') return resolved
      return fallback
    },
  )

  return withFallback.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const resolved = resolveTemplateVar(key, vars, messageText)
    if (resolved === undefined) return match
    return resolved
  })
}
