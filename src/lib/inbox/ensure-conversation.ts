import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';

export type ConversationCreateStatus =
  | 'open'
  | 'closed'
  | 'pending'
  | 'followup';

interface ConversationCandidate {
  id: string;
  status?: string;
  last_message_at?: string | null;
  created_at?: string;
}

/**
 * All conversations for a contact within an account. Normally 0–1
 * rows; may return multiple before migration 067 backfill runs.
 */
export async function findConversationsForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ConversationCandidate[]> {
  const { data, error } = await db
    .from('conversations')
    .select('id, status, last_message_at, created_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId);

  if (error) {
    console.error('[inbox] findConversationsForContact failed:', error.message);
    return [];
  }

  return (data ?? []) as ConversationCandidate[];
}

/**
 * When duplicate shells exist, pick the thread agents should see:
 * most messages, then latest activity, then oldest row.
 */
export async function pickCanonicalConversationId(
  db: SupabaseClient,
  candidates: ConversationCandidate[],
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.id;

  const ids = candidates.map((c) => c.id);
  const { data: messageRows, error } = await db
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', ids);

  if (error) {
    console.error('[inbox] pickCanonicalConversationId count failed:', error.message);
  }

  const countByConv = new Map<string, number>();
  for (const id of ids) countByConv.set(id, 0);
  for (const row of messageRows ?? []) {
    const convId = (row as { conversation_id: string }).conversation_id;
    countByConv.set(convId, (countByConv.get(convId) ?? 0) + 1);
  }

  const sorted = [...candidates].sort((a, b) => {
    const countDiff =
      (countByConv.get(b.id) ?? 0) - (countByConv.get(a.id) ?? 0);
    if (countDiff !== 0) return countDiff;

    const aTs = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const bTs = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    if (bTs !== aTs) return bTs - aTs;

    const aCreated = a.created_at ? Date.parse(a.created_at) : 0;
    const bCreated = b.created_at ? Date.parse(b.created_at) : 0;
    return aCreated - bCreated;
  });

  return sorted[0]?.id ?? null;
}

/**
 * Find or create the single inbox thread for a contact. Handles
 * duplicate rows left over from pre-067 races and concurrent inserts
 * via the unique index on (account_id, contact_id).
 */
export async function ensureConversationForContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
  opts?: { createStatus?: ConversationCreateStatus },
): Promise<{ id: string } | null> {
  const createStatus = opts?.createStatus ?? 'closed';

  const existing = await findConversationsForContact(db, accountId, contactId);
  const canonicalId = await pickCanonicalConversationId(db, existing);
  if (canonicalId) return { id: canonicalId };

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      status: createStatus,
    })
    .select('id')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findConversationsForContact(db, accountId, contactId);
      const racedId = await pickCanonicalConversationId(db, raced);
      if (racedId) return { id: racedId };
    }
    console.error('[inbox] ensureConversationForContact failed:', error.message);
    return null;
  }

  return created;
}
