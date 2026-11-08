/**
 * Resolve {{ vars.* }}, {{ trigger.* }}, {{ message.text }}, bare {{name}},
 * and fallback forms like {{ vars.name | "there" }}.
 */

import { decodeVariableFallback } from './variable-fallback';

export function resolveTemplateVar(
  key: string,
  vars: Record<string, unknown>,
  messageText?: string
): string | undefined {
  if (key === 'message.text') return messageText ?? '';

  let lookup = key;
  const hadPrefix = key.startsWith('vars.') || key.startsWith('trigger.');
  if (key.startsWith('vars.')) lookup = key.slice(5);
  else if (key.startsWith('trigger.')) lookup = key.slice(8);

  if (lookup in vars) {
    const val = vars[lookup];
    return val === undefined || val === null ? '' : String(val);
  }
  if (hadPrefix) return '';
  if (key in vars) return String(vars[key] ?? '');
  return undefined;
}

/** Variable keys referenced in `template` that resolve empty and have no fallback. */
export function missingTemplateVariables(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string
): string[] {
  const missing: string[] = [];
  for (const match of template.matchAll(
    /\{\{\s*([\w.]+)\s*(?:\|\s*("(?:\\.|[^"\\])*"|'[^']*'))?\s*\}\}/g
  )) {
    const [, key, quoted] = match;
    if (quoted && decodeVariableFallback(quoted).trim()) continue;
    const resolved = resolveTemplateVar(key, vars, messageText);
    if ((resolved === undefined || resolved.trim() === '') && !missing.includes(key))
      missing.push(key);
  }
  return missing;
}

export function interpolateTemplateString(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string,
  encode: (value: string) => string = (value) => value
): string {
  if (!template) return '';

  return template.replace(
    /\{\{\s*([\w.]+)\s*(?:\|\s*("(?:\\.|[^"\\])*"|'[^']*'))?\s*\}\}/g,
    (match, key: string, quoted: string | undefined) => {
      const resolved = resolveTemplateVar(key, vars, messageText);
      if (quoted && (resolved === undefined || resolved.trim() === '')) {
        const fallback = decodeVariableFallback(quoted);
        return encode(fallback);
      }
      return resolved === undefined ? match : encode(resolved);
    }
  );
}
