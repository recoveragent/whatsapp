/**
 * Handlers for WhatsApp Business app coexistence webhook fields:
 *   history, smb_app_state_sync, smb_message_echoes
 *
 * Subscribe to these in Meta App Dashboard → WhatsApp → Configuration.
 * After coexistence onboarding, persist-config also calls smb_app_data
 * to initiate contact/history sync (must complete within 24 hours).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact } from '@/lib/contacts/dedupe';
import { ensureConversationForContact } from '@/lib/inbox/ensure-conversation';
import {
  canonicalContactPhone,
  normalizePhone,
} from '@/lib/whatsapp/phone-utils';

const COEXISTENCE_WEBHOOK_FIELDS = new Set([
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
]);

export function isCoexistenceWebhookField(field: string): boolean {
  return COEXISTENCE_WEBHOOK_FIELDS.has(field);
}

export interface CoexistenceWebhookChange {
  field: string;
  value: unknown;
}

interface WebhookMetadata {
  phone_number_id?: string;
  display_phone_number?: string;
}

interface SyncContact {
  full_name?: string;
  first_name?: string;
  phone_number?: string;
}

interface SyncMessage {
  id?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  history_context?: { status?: string };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function loadConfigByPhoneNumberId(
  db: SupabaseClient,
  phoneNumberId: string,
) {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('phone_number_id', phoneNumberId);

  if (error || !data?.length) return null;
  if (data.length > 1) {
    console.warn(
      `[coexistence-webhook] multiple configs for phone_number_id ${phoneNumberId}`,
    );
  }
  return data[0] as {
    account_id: string;
    user_id: string;
    phone_number_id: string;
  };
}

async function upsertContactFromSync(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contact: SyncContact,
) {
  const rawPhone = contact.phone_number?.trim();
  if (!rawPhone) return;

  const phone = canonicalContactPhone(normalizePhone(rawPhone));
  const name =
    contact.full_name?.trim() ||
    contact.first_name?.trim() ||
    phone;

  const existing = await findExistingContact(db, accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return;
  }

  const { error } = await db.from('contacts').insert({
    account_id: accountId,
    user_id: ownerUserId,
    phone,
    name,
  });
  if (error) {
    console.warn('[coexistence-webhook] contact insert failed:', error.message);
  }
}

async function messageExists(db: SupabaseClient, metaMessageId: string) {
  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('message_id', metaMessageId);
  return (count ?? 0) > 0;
}

async function ingestSyncedMessage(
  db: SupabaseClient,
  config: { account_id: string; user_id: string },
  message: SyncMessage,
  direction: 'inbound' | 'outbound',
) {
  if (!message.id || message.history_context?.status === 'deleted') return;
  if (await messageExists(db, message.id)) return;

  const customerPhoneRaw =
    direction === 'inbound' ? message.from : message.to;
  if (!customerPhoneRaw) return;

  const customerPhone = canonicalContactPhone(normalizePhone(customerPhoneRaw));
  const contentText =
    message.type === 'text' ? message.text?.body?.trim() ?? '' : '';

  if (!contentText && message.type !== 'text') {
    // History sync can include media — ingest text only for now.
    return;
  }

  const existing = await findExistingContact(
    db,
    config.account_id,
    customerPhone,
  );
  let contactId = existing?.id;

  if (!contactId) {
    const { data: created, error } = await db
      .from('contacts')
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        phone: customerPhone,
        name: customerPhone,
      })
      .select('id')
      .single();
    if (error || !created) {
      console.warn('[coexistence-webhook] contact create failed:', error?.message);
      return;
    }
    contactId = created.id as string;
  }

  const ensured = await ensureConversationForContact(
    db,
    config.account_id,
    config.user_id,
    contactId,
    { createStatus: 'open' },
  );
  if (!ensured) return;

  const conversationId = ensured.id;

  const createdAt = message.timestamp
    ? new Date(parseInt(message.timestamp, 10) * 1000).toISOString()
    : new Date().toISOString();

  const senderType = direction === 'inbound' ? 'customer' : 'agent';

  const { error: insertError } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: senderType,
    content_type: 'text',
    content_text: contentText || '(message)',
    message_id: message.id,
    status: 'delivered',
    created_at: createdAt,
  });
  if (insertError) {
    console.warn('[coexistence-webhook] message insert failed:', insertError.message);
    return;
  }

  const preview =
    contentText.length > 100 ? `${contentText.slice(0, 100)}…` : contentText;

  await db
    .from('conversations')
    .update({
      last_message_at: createdAt,
      last_message_text: preview || '(message)',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}

function collectSyncMessages(value: Record<string, unknown>): SyncMessage[] {
  const collected: SyncMessage[] = [];

  const topLevel = value.messages;
  if (Array.isArray(topLevel)) {
    collected.push(...(topLevel as SyncMessage[]));
  }

  const history = value.history;
  if (Array.isArray(history)) {
    for (const chunk of history) {
      const chunkRec = asRecord(chunk);
      const msgs = chunkRec?.messages;
      if (Array.isArray(msgs)) {
        collected.push(...(msgs as SyncMessage[]));
      }
    }
  }

  return collected;
}

export async function handleCoexistenceWebhookChange(
  change: CoexistenceWebhookChange,
  db: SupabaseClient,
) {
  const value = asRecord(change.value);
  if (!value) return;

  const metadata = asRecord(value.metadata) as WebhookMetadata | null;
  const phoneNumberId = metadata?.phone_number_id;
  if (!phoneNumberId) {
    console.warn('[coexistence-webhook] missing phone_number_id in metadata');
    return;
  }

  const config = await loadConfigByPhoneNumberId(db, phoneNumberId);
  if (!config) {
    console.warn(
      '[coexistence-webhook] no whatsapp_config for phone_number_id:',
      phoneNumberId,
    );
    return;
  }

  if (change.field === 'smb_app_state_sync') {
    const stateSync = value.state_sync;
    if (!Array.isArray(stateSync)) return;

    for (const entry of stateSync) {
      const rec = asRecord(entry);
      if (rec?.type !== 'contact') continue;
      const contact = asRecord(rec.contact) as SyncContact | null;
      if (!contact) continue;
      await upsertContactFromSync(
        db,
        config.account_id,
        config.user_id,
        contact,
      );
    }
    return;
  }

  const messages = collectSyncMessages(value);
  const direction =
    change.field === 'smb_message_echoes' ? 'outbound' : 'inbound';

  for (const message of messages) {
    await ingestSyncedMessage(db, config, message, direction);
  }
}
