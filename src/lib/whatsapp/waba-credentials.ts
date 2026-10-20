import { supabaseAdmin } from '@/lib/flows/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'

/** Distinct WABAs connected to an account, with decrypted tokens. */
export async function loadAccountWabas(
  accountId: string,
): Promise<Array<{ wabaId: string; accessToken: string }>> {
  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('waba_id, access_token')
    .eq('account_id', accountId)
  if (error) throw new Error(error.message)
  const seen = new Set<string>()
  const out: Array<{ wabaId: string; accessToken: string }> = []
  for (const row of (data ?? []) as Array<{ waba_id: string | null; access_token: string | null }>) {
    if (!row.waba_id || !row.access_token || seen.has(row.waba_id)) continue
    seen.add(row.waba_id)
    out.push({ wabaId: row.waba_id, accessToken: decrypt(row.access_token) })
  }
  return out
}
