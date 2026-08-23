import { NextResponse } from 'next/server'

import {
  BrandContextRequiredError,
  ForbiddenError,
  UnauthorizedError,
  requireLeadGenAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  getGoogleRedirectUri,
  isGoogleOAuthConfigured,
} from '@/lib/google-sheets/config'
import { buildGoogleAuthorizeUrl } from '@/lib/google-sheets/oauth'
import { createGoogleOAuthState } from '@/lib/google-sheets/persist-config'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * POST /api/google-sheets/oauth/start
 */
export async function POST(request: Request) {
  try {
    if (!isGoogleOAuthConfigured()) {
      return NextResponse.json(
        {
          error:
            'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        },
        { status: 503 },
      )
    }

    const ctx = await requireLeadGenAccount('admin')
    const state = await createGoogleOAuthState({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
    })

    const redirectUri = getGoogleRedirectUri(request)
    const authorizeUrl = buildGoogleAuthorizeUrl({ redirectUri, state })

    return NextResponse.json({ authorize_url: authorizeUrl })
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json(
        { error: 'Sign in again to connect Google Sheets' },
        { status: 401 },
      )
    }
    if (err instanceof BrandContextRequiredError) {
      return NextResponse.json(
        {
          error: 'Open a brand first, then connect Google Sheets',
          needsBrandContext: true,
        },
        { status: 403 },
      )
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    console.error('[google-sheets oauth start]', err)
    return toErrorResponse(err)
  }
}
