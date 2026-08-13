import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  getGoogleRedirectUri,
  getGoogleSettingsOrigin,
  isGoogleOAuthConfigured,
} from '@/lib/google-sheets/config'
import {
  exchangeGoogleOAuthCode,
  fetchGoogleUserEmail,
} from '@/lib/google-sheets/oauth'
import {
  consumeGoogleOAuthState,
  persistGoogleSheetsConfig,
} from '@/lib/google-sheets/persist-config'

function settingsRedirect(
  origin: string,
  params: Record<string, string>,
): NextResponse {
  const url = new URL(`${origin}/settings`)
  url.searchParams.set('tab', 'google_sheets')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return NextResponse.redirect(url.toString())
}

/**
 * GET /api/google-sheets/oauth/callback
 */
export async function GET(request: Request) {
  const settingsOrigin = getGoogleSettingsOrigin(request)
  const { searchParams } = new URL(request.url)

  try {
    if (!isGoogleOAuthConfigured()) {
      return settingsRedirect(settingsOrigin, {
        google_sheets_error: 'Google OAuth is not configured on the server',
      })
    }

    const oauthError = searchParams.get('error')
    if (oauthError) {
      const description = searchParams.get('error_description')
      const message = description?.trim()
        ? `${oauthError}: ${description}`
        : oauthError
      return settingsRedirect(settingsOrigin, { google_sheets_error: message })
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code || !state) {
      return settingsRedirect(settingsOrigin, {
        google_sheets_error: 'Missing OAuth parameters from Google',
      })
    }

    const oauthState = await consumeGoogleOAuthState(supabaseAdmin(), state)
    if (!oauthState) {
      return settingsRedirect(settingsOrigin, {
        google_sheets_error: 'OAuth session expired — try connecting again',
      })
    }

    const redirectUri = getGoogleRedirectUri(request)
    const token = await exchangeGoogleOAuthCode({ code, redirectUri })

    if (!token.refresh_token) {
      return settingsRedirect(settingsOrigin, {
        google_sheets_error:
          'Google did not return a refresh token. Disconnect the app in your Google Account permissions and try again.',
      })
    }

    const googleEmail = await fetchGoogleUserEmail(token.access_token)
    const scopes = (token.scope ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const tokenExpiry = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null

    const result = await persistGoogleSheetsConfig({
      db: supabaseAdmin(),
      accountId: oauthState.account_id,
      userId: oauthState.user_id,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiry,
      googleEmail,
      scopes,
    })

    if (!result.ok) {
      return settingsRedirect(settingsOrigin, {
        google_sheets_error: result.error,
      })
    }

    return settingsRedirect(settingsOrigin, { google_sheets_connected: '1' })
  } catch (err) {
    console.error('[google-sheets oauth callback]', err)
    const message =
      err instanceof Error ? err.message : 'Google Sheets connection failed'
    return settingsRedirect(settingsOrigin, { google_sheets_error: message })
  }
}
