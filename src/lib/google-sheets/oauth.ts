import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleScopes,
} from './config'

export interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export function buildGoogleAuthorizeUrl(args: {
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', getGoogleClientId())
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', getGoogleScopes())
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', args.state)
  return url.toString()
}

export async function exchangeGoogleOAuthCode(args: {
  code: string
  redirectUri: string
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json().catch(() => null)) as
    | (GoogleTokenResponse & { error?: string; error_description?: string })
    | null

  if (!res.ok || !data?.access_token) {
    const message =
      data?.error_description || data?.error || `Google token exchange failed (${res.status})`
    throw new Error(message)
  }

  return data
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = (await res.json().catch(() => null)) as
    | (GoogleTokenResponse & { error?: string; error_description?: string })
    | null

  if (!res.ok || !data?.access_token) {
    const message =
      data?.error_description || data?.error || `Google token refresh failed (${res.status})`
    throw new Error(message)
  }

  return data
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { email?: string } | null
  return data?.email?.trim() || null
}
