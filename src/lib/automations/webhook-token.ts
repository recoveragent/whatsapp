/** Secret prefix on automation webhook tokens. */
export const WEBHOOK_TOKEN_PREFIX = 'whk_'

/**
 * Generate a fresh opaque webhook token for an automation URL.
 * Uses Web Crypto so this module is safe to import from client
 * components (node:crypto `base64url` is not available in browsers).
 */
export function generateWebhookToken(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${WEBHOOK_TOKEN_PREFIX}${body}`
}

export function looksLikeWebhookToken(value: string): boolean {
  return value.startsWith(WEBHOOK_TOKEN_PREFIX) && value.length > WEBHOOK_TOKEN_PREFIX.length
}
