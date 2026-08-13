import { getConfiguredSiteUrl, getServerRedirectOrigin } from '@/lib/auth/site-url'

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID?.trim()
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not configured')
  return id
}

export function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET is not configured')
  return secret
}

export function getGoogleScopes(): string {
  return process.env.GOOGLE_SHEETS_SCOPES?.trim() || DEFAULT_SCOPES
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  )
}

/** Origin for OAuth redirect + Settings return. Allows localhost for local Google OAuth testing. */
export function getGoogleOAuthOrigin(request: Request): string {
  const configured = getConfiguredSiteUrl()?.replace(/\/$/, '')
  if (configured) return configured
  const fromRequest = getServerRedirectOrigin(request)?.replace(/\/$/, '')
  if (fromRequest) return fromRequest
  return new URL(request.url).origin.replace(/\/$/, '')
}

export function getGoogleRedirectUri(request: Request): string {
  const envUri = process.env.GOOGLE_REDIRECT_URI?.trim()
  if (envUri) return envUri.replace(/\/$/, '')
  return `${getGoogleOAuthOrigin(request)}/api/google-sheets/oauth/callback`
}

export function getGoogleSettingsOrigin(request: Request): string {
  return getGoogleOAuthOrigin(request)
}
