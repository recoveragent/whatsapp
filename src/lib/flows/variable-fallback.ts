/** The UI edits fallbacks separately; storage keeps the existing expression format. */
const TOKEN = /\{\{\s*([\w.]+)\s*(?:\|\s*("(?:\\.|[^"\\])*"|'[^']*'))?\s*\}\}/g;

export function decodeVariableFallback(quoted: string): string {
  if (quoted.startsWith('"')) {
    try { return JSON.parse(quoted) as string; } catch { /* Legacy literal backslashes. */ }
  }
  return quoted.slice(1, -1);
}

export function variableFallbacks(value: string) {
  return Array.from(value.matchAll(TOKEN), (match) => ({
    key: match[1],
    fallback: match[2] ? decodeVariableFallback(match[2]) : '',
  })).filter(
    (item, index, all) =>
      all.findIndex((other) => other.key === item.key) === index
  );
}

/** Header image fallbacks are uploaded files, stored as their public URL. */
export const MEDIA_FALLBACK_MESSAGE =
  'Upload an image to send when this variable is empty.';

export function isMediaFallbackUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

export function setVariableFallback(
  value: string,
  key: string,
  fallback: string
): string {
  return value.replace(TOKEN, (match, name: string) =>
    name === key
      ? fallback
        ? `{{ ${name} | ${JSON.stringify(fallback)} }}`
        : `{{ ${name} }}`
      : match
  );
}

export function withoutVariableFallbacks(value: string): string {
  return value.replace(TOKEN, (_match, key: string) => `{{ ${key} }}`);
}

export function preserveVariableFallbacks(
  next: string,
  previous: string
): string {
  for (const item of variableFallbacks(previous)) {
    if (
      !variableFallbacks(next).find((other) => other.key === item.key)?.fallback
    ) {
      next = setVariableFallback(next, item.key, item.fallback);
    }
  }
  return next;
}

export function missingVariableFallbacks(
  value: unknown,
  path = ''
): { path: string; key: string }[] {
  if (typeof value === 'string') {
    return variableFallbacks(value)
      .filter((item) => !item.fallback.trim() || item.fallback.includes('{{'))
      .map((item) => ({ path, key: item.key }));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    missingVariableFallbacks(child, path ? `${path}.${key}` : key)
  );
}
