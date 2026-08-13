import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { encrypt } from '@/lib/whatsapp/encryption'

export async function createGoogleOAuthState(args: {
  db: SupabaseClient
  accountId: string
  userId: string
}): Promise<string> {
  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  const { error } = await args.db.from('google_sheets_oauth_states').insert({
    state_token: token,
    account_id: args.accountId,
    user_id: args.userId,
    expires_at: expiresAt,
  })

  if (error) throw new Error('Failed to create OAuth state')
  return token
}

export async function consumeGoogleOAuthState(
  db: SupabaseClient,
  state: string,
): Promise<{ account_id: string; user_id: string } | null> {
  const { data, error } = await db
    .from('google_sheets_oauth_states')
    .select('account_id, user_id, expires_at')
    .eq('state_token', state)
    .maybeSingle()

  await db.from('google_sheets_oauth_states').delete().eq('state_token', state)

  if (error || !data) return null
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null

  return {
    account_id: data.account_id as string,
    user_id: data.user_id as string,
  }
}

export async function persistGoogleSheetsConfig(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  accessToken: string
  refreshToken: string
  tokenExpiry: Date | null
  googleEmail: string | null
  scopes: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!args.accessToken.trim() || !args.refreshToken.trim()) {
    return { ok: false, error: 'Missing Google OAuth tokens' }
  }

  const { error } = await args.db.from('google_sheets_config').upsert(
    {
      account_id: args.accountId,
      user_id: args.userId,
      access_token: encrypt(args.accessToken.trim()),
      refresh_token: encrypt(args.refreshToken.trim()),
      token_expiry: args.tokenExpiry?.toISOString() ?? null,
      google_email: args.googleEmail,
      scopes: args.scopes,
      status: 'connected',
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )

  if (error) {
    console.error('[google-sheets] persist upsert failed:', error)
    return { ok: false, error: 'Failed to save Google Sheets connection' }
  }

  return { ok: true }
}
