import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import {
  ensureConversationForContact,
  type ConversationCreateStatus,
} from '@/lib/inbox/ensure-conversation';
import { canonicalContactPhone, normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface EnsuredContact {
  id: string;
  phone: string;
  name?: string | null;
}

/**
 * Find or create a contact for outbound Shopify campaign messages.
 */
export async function ensureShopifyContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
): Promise<EnsuredContact | null> {
  const normalized = canonicalContactPhone(normalizePhone(phone));
  if (!normalized || normalized.length < 8) return null;

  const existing = await findExistingContact(db, accountId, normalized);
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { id: existing.id, phone: existing.phone, name: name || existing.name };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone: normalized,
      name: name || normalized,
    })
    .select('id, phone, name')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, normalized);
      if (raced) return { id: raced.id, phone: raced.phone, name: raced.name };
    }
    console.error('[shopify] ensureShopifyContact failed:', error);
    return null;
  }

  return created;
}

/**
 * Find or create a conversation for a contact.
 *
 * `createStatus` applies only when inserting a new row (existing
 * conversations are returned unchanged).
 *
 * - Shopify campaigns / flows / outbound automations: `'closed'` so
 *   order confirmations don't crowd the Open inbox until the customer
 *   replies (inbound webhook reopens closed/followup).
 * - Agent "New message" inbox: `'open'`.
 */
export async function ensureConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
  opts?: { createStatus?: ConversationCreateStatus; whatsappConfigId?: string | null },
): Promise<{ id: string } | null> {
  return ensureConversationForContact(db, accountId, ownerUserId, contactId, {
    createStatus: opts?.createStatus ?? 'closed',
    whatsappConfigId: opts?.whatsappConfigId ?? null,
  });
}

const OPEN_FLOW_RUN_STATUSES = ['active', 'waiting'] as const;

/**
 * True when a flow is still running for this contact (e.g. mid-template
 * send). Callers must not delete the conversation shell in that window —
 * duplicate Shopify webhooks otherwise race and drop the FK on messages.
 */
export async function hasActiveFlowRunForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { count, error } = await db
    .from('flow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .in('status', [...OPEN_FLOW_RUN_STATUSES]);

  if (error) {
    console.error('[shopify] hasActiveFlowRunForContact failed:', error);
    // Conservative: assume busy so we never delete a thread mid-send.
    return true;
  }

  return (count ?? 0) > 0;
}

async function flowRunsHaveUnpersistedMessageSent(
  db: SupabaseClient,
  runIds: string[],
): Promise<boolean> {
  if (runIds.length === 0) return false;

  const { data: events, error: eventsErr } = await db
    .from('flow_run_events')
    .select('payload')
    .in('flow_run_id', runIds)
    .eq('event_type', 'message_sent');

  if (eventsErr) {
    console.error('[shopify] flowRunsHaveUnpersistedMessageSent failed:', eventsErr);
    return true;
  }

  const wamids = [
    ...new Set(
      (events ?? [])
        .map((row) => {
          const payload = (row as { payload?: Record<string, unknown> }).payload ?? {};
          const wamid = payload.whatsapp_message_id;
          return typeof wamid === 'string' ? wamid.trim() : '';
        })
        .filter(Boolean),
    ),
  ];
  if (wamids.length === 0) return false;

  const { data: existing, error: msgErr } = await db
    .from('messages')
    .select('message_id')
    .in('message_id', wamids);

  if (msgErr) {
    console.error('[shopify] flowRunsHaveUnpersistedMessageSent messages failed:', msgErr);
    return true;
  }

  const persisted = new Set(
    (existing ?? [])
      .map((r) => (r as { message_id?: string }).message_id)
      .filter(Boolean) as string[],
  );

  return wamids.some((wamid) => !persisted.has(wamid));
}

/**
 * True when a flow run logged a Meta send that never landed in
 * `messages` (typically "sent to Meta but DB insert failed"). Keep the
 * conversation shell so the customer's reply reopens the same thread
 * and a retry/backfill can attach the outbound bubble later.
 */
export async function conversationHasOrphanedMetaSend(
  db: SupabaseClient,
  conversationId: string,
  contactId?: string,
): Promise<boolean> {
  const { data: runs, error: runsErr } = await db
    .from('flow_runs')
    .select('id')
    .eq('conversation_id', conversationId);

  if (runsErr) {
    console.error('[shopify] conversationHasOrphanedMetaSend runs failed:', runsErr);
    return true;
  }

  const runIds = (runs ?? []).map((r) => (r as { id: string }).id);

  if (runIds.length > 0) {
    const { data: errorEvents, error: eventsErr } = await db
      .from('flow_run_events')
      .select('payload')
      .in('flow_run_id', runIds)
      .eq('event_type', 'error');

    if (eventsErr) {
      console.error('[shopify] conversationHasOrphanedMetaSend events failed:', eventsErr);
      return true;
    }

    for (const row of errorEvents ?? []) {
      const payload = (row as { payload?: Record<string, unknown> }).payload ?? {};
      const reason = String(payload.reason ?? '');
      const detail = String(payload.detail ?? '');
      if (
        reason.includes('sent to Meta but DB insert failed') ||
        detail.includes('sent to Meta but DB insert failed')
      ) {
        return true;
      }
    }

    if (await flowRunsHaveUnpersistedMessageSent(db, runIds)) {
      return true;
    }
  }

  if (contactId) {
    const { data: orphanedRuns, error: orphanErr } = await db
      .from('flow_runs')
      .select('id')
      .eq('contact_id', contactId)
      .is('conversation_id', null);

    if (orphanErr) {
      console.error('[shopify] conversationHasOrphanedMetaSend orphan runs failed:', orphanErr);
      return true;
    }

    const orphanIds = (orphanedRuns ?? []).map((r) => (r as { id: string }).id);
    if (await flowRunsHaveUnpersistedMessageSent(db, orphanIds)) {
      return true;
    }
  }

  return false;
}

/**
 * Delete a conversation that never received any WhatsApp message (and
 * has no private notes). Used after Shopify outbound attempts that
 * created a thread without landing a send — empty shells must not
 * appear in Open or Closed.
 */
export async function deleteConversationIfEmpty(
  db: SupabaseClient,
  conversationId: string,
  opts?: { accountId?: string; contactId?: string },
): Promise<void> {
  if (opts?.accountId && opts?.contactId) {
    if (await hasActiveFlowRunForContact(db, opts.accountId, opts.contactId)) {
      return;
    }
  }

  const { count: activeRunOnConv, error: runOnConvErr } = await db
    .from('flow_runs')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .in('status', [...OPEN_FLOW_RUN_STATUSES]);

  if (runOnConvErr) {
    console.error('[shopify] deleteConversationIfEmpty run lookup failed:', runOnConvErr);
    return;
  }
  if ((activeRunOnConv ?? 0) > 0) return;

  const { count: msgCount, error: msgErr } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (msgErr || (msgCount ?? 0) > 0) return;

  const { count: noteCount, error: noteErr } = await db
    .from('conversation_private_notes')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId);

  if (noteErr || (noteCount ?? 0) > 0) return;

  if (await conversationHasOrphanedMetaSend(db, conversationId, opts?.contactId)) {
    return;
  }

  const { error: deleteErr } = await db
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (deleteErr) {
    console.error('[shopify] deleteConversationIfEmpty failed:', deleteErr);
  }
}
