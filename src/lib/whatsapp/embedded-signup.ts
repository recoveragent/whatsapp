import { randomBytes } from 'node:crypto';

/** Public Meta App ID for the Facebook JS SDK. */
export function getMetaAppId(): string | null {
  const id =
    process.env.NEXT_PUBLIC_META_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim();
  return id || null;
}

export function getEmbeddedSignupConfigId(): string | null {
  const id = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  return id || null;
}

export function isEmbeddedSignupEnabled(): boolean {
  return Boolean(getMetaAppId() && getEmbeddedSignupConfigId());
}

/** Random verify token for webhook handshake (stored per brand). */
export function generateWebhookVerifyToken(): string {
  return randomBytes(24).toString('hex');
}
