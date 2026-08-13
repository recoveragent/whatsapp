import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  getGoogleRedirectUri,
  isGoogleOAuthConfigured,
} from '@/lib/google-sheets/config'

/**
 * GET /api/google-sheets/connection
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const redirectUri = getGoogleRedirectUri(request)
    const oauthAvailable = isGoogleOAuthConfigured()

    const { data: config, error } = await ctx.supabase
      .from('google_sheets_config')
      .select('google_email, status, connected_at, scopes')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load connection status' },
        { status: 500 },
      )
    }

    if (!config) {
      return NextResponse.json({
        configured: false,
        connected: false,
        oauth_available: oauthAvailable,
        redirect_uri: redirectUri,
        message: oauthAvailable
          ? 'Connect a Google account to read Sheets for Flow triggers.'
          : 'Server is missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.',
      })
    }

    const connected = config.status === 'connected'

    return NextResponse.json({
      configured: true,
      connected,
      oauth_available: oauthAvailable,
      redirect_uri: redirectUri,
      google_email: config.google_email,
      connected_at: config.connected_at,
      scopes: config.scopes,
      message: connected
        ? 'Google Sheets connected. Create a Flow with the Google Sheet row trigger.'
        : 'Reconnect Google to restore Sheet polling.',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/google-sheets/connection
 */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin')

    const { error } = await ctx.supabase
      .from('google_sheets_config')
      .delete()
      .eq('account_id', ctx.accountId)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to disconnect Google Sheets' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
