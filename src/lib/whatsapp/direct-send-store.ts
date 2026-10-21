import type { SupabaseClient } from '@supabase/supabase-js';
import { isDirectSendUnavailableError } from './direct-send';

/** Only eligibility rejections change capability; network/content errors do not. */
export async function recordDirectSendRejection(
  db: SupabaseClient,
  accountId: string,
  configId: string,
  message: string
): Promise<boolean> {
  if (!isDirectSendUnavailableError(message)) return false;
  try {
    const { error } = await db.from('whatsapp_config')
      .update({ direct_send_status: 'unavailable' })
      .eq('account_id', accountId).eq('id', configId);
    if (error) console.error('[direct-send] Could not record unavailable status:', error.message);
  } catch (err) {
    console.error('[direct-send] Could not record unavailable status:', err);
  }
  return true;
}
