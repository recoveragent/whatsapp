import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Only a hash of the browser's random session key is stored. */
export async function saveWebsiteTurn(db: SupabaseClient, accountId: string, sessionKey: unknown, role: 'user' | 'assistant', content: string): Promise<void> {
  if (typeof sessionKey !== 'string' || !/^[0-9a-f]{64}$/.test(sessionKey)) return;
  const hash = createHash('sha256').update(sessionKey).digest('hex');
  const now = new Date().toISOString();
  const { data: session, error } = await db.from('website_chat_sessions').upsert({
    account_id: accountId, session_hash: hash, last_message_at: now, last_message_text: content.slice(0, 500),
  }, { onConflict: 'account_id,session_hash' }).select('id').single();
  if (error || !session) throw error ?? new Error('Website session unavailable');
  const { error: messageError } = await db.from('website_chat_messages').insert({
    session_id: session.id, account_id: accountId, role, content: content.slice(0, 4500),
  });
  if (messageError) throw messageError;
}
