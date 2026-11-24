import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

const GRAPH = 'https://graph.facebook.com/v27.0';
const DAY_MS = 24 * 60 * 60_000;
/** Renew well before expiry, leaving time to reconnect by hand if renewal keeps failing. */
export const RENEW_WITHIN_MS = 20 * DAY_MS;
const BATCH = 20;

type TokenInfo = { valid: boolean; expiresAt: number | null; scopes: string[]; appId: string | null };

/** Meta's view of a token, or null when it could not be checked. */
async function inspect(token: string, appId: string, secret: string): Promise<TokenInfo | null> {
  const response = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${appId}|${secret}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const data = response?.ok ? (await response.json().catch(() => null))?.data : null;
  if (!data || typeof data.is_valid !== 'boolean') return null;
  const expires = Number(data.expires_at);
  return { valid: data.is_valid, expiresAt: expires > 0 ? expires * 1000 : null, scopes: Array.isArray(data.scopes) ? data.scopes : [], appId: typeof data.app_id === 'string' ? data.app_id : null };
}

async function renew(token: string, appId: string, secret: string): Promise<string | null> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  for (const [k, v] of Object.entries({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, set_token_expires_in_60_days: 'true', fb_exchange_token: token })) url.searchParams.set(k, v);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = response?.ok ? await response.json().catch(() => null) : null;
  return typeof body?.access_token === 'string' ? body.access_token : null;
}

export type TokenRunResult = { checked: number; renewed: number; problems: number };

/** Once a day per connection: record when the login expires and renew it before it does. */
export async function maintainInstagramTokens(admin: SupabaseClient, now = Date.now()): Promise<TokenRunResult> {
  const result: TokenRunResult = { checked: 0, renewed: 0, problems: 0 };
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return result;
  const due = `token_checked_at.is.null,token_checked_at.lt.${new Date(now - DAY_MS).toISOString()}`;
  const { data: rows, error } = await admin.from('instagram_connections').select('id,access_token').not('access_token', 'is', null).or(due).limit(BATCH);
  if (error) throw new Error(error.message);
  for (const row of rows ?? []) {
    // Claim the row so overlapping runs do not both renew it.
    const { data: claimed, error: claimError } = await admin.from('instagram_connections').update({ token_checked_at: new Date(now).toISOString() }).eq('id', row.id).eq('access_token', row.access_token).or(due).select('id').maybeSingle();
    if (claimError || !claimed) continue;
    // Every write matches the token that was checked, so a reconnect in between always wins.
    const save = async (values: Record<string, unknown>) => {
      const { data: saved, error: saveError } = await admin.from('instagram_connections').update(values).eq('id', row.id).eq('access_token', row.access_token).select('id').maybeSingle();
      if (saveError) console.error('[instagram token] could not save', saveError.code);
      return !saveError && saved !== null;
    };
    try {
      const token = decrypt(row.access_token);
      const info = await inspect(token, appId, secret);
      if (!info) { result.problems++; continue; }
      result.checked++;
      if (!info.valid) {
        result.problems++;
        await save({ token_error: 'Instagram login is no longer valid. Reconnect Instagram.' });
        continue;
      }
      const expiry = info.expiresAt === null ? null : new Date(info.expiresAt).toISOString();
      if (info.expiresAt === null || info.expiresAt - now > RENEW_WITHIN_MS) {
        await save({ token_expires_at: expiry, token_error: null });
        continue;
      }
      const fresh = await renew(token, appId, secret);
      const freshInfo = fresh ? await inspect(fresh, appId, secret) : null;
      // Replace the working token only with one that is valid, lasts longer and has the same permissions.
      const usable = fresh !== null && freshInfo !== null && freshInfo.valid && freshInfo.appId === info.appId
        && (freshInfo.expiresAt === null || freshInfo.expiresAt > info.expiresAt) && info.scopes.every((scope) => freshInfo.scopes.includes(scope));
      if (usable && await save({ access_token: encrypt(fresh), token_expires_at: freshInfo.expiresAt === null ? null : new Date(freshInfo.expiresAt).toISOString(), token_error: null })) {
        result.renewed++;
      } else {
        result.problems++;
        await save({ token_expires_at: expiry, token_error: 'Instagram login could not be renewed automatically. Reconnect Instagram before it expires.' });
      }
    } catch (err) {
      result.problems++;
      console.error('[instagram token] check failed', err instanceof Error ? err.name : 'unknown');
    }
  }
  return result;
}
