import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import type { InstagramEvent } from './webhook';

const GRAPH = 'https://graph.facebook.com/v27.0';
/** Only conversations touched this recently are re-read each tick. */
export const SYNC_CONVERSATION_WINDOW_MS = 15 * 60_000;
/** Never import messages older than this (and never older than the connection). */
export const SYNC_MESSAGE_MAX_AGE_MS = 24 * 60 * 60_000;
const CONVERSATION_LIMIT = 25;
const MESSAGES_PER_CONVERSATION = 20;

type GraphUser = { id?: unknown; username?: unknown };
type GraphMessage = { id?: unknown; created_time?: unknown; message?: unknown; from?: GraphUser; to?: { data?: GraphUser[] }; attachments?: unknown };
type GraphConversation = { updated_time?: unknown; messages?: { data?: GraphMessage[] } };

/** Meta returns "2026-11-23T16:51:51+0000"; make the offset ISO-8601 compliant before parsing. */
export function parseGraphTime(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  return Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

/**
 * Convert a Graph API conversations page into the same events the webhook
 * produces, so both paths share instagram_record_message (which ignores
 * message IDs it has already stored).
 */
export function conversationsToEvents(accountId: string, conversations: unknown, opts: { now: number; notBefore: number }): InstagramEvent[] {
  if (!Array.isArray(conversations)) return [];
  const events: InstagramEvent[] = [];
  for (const conversation of conversations as GraphConversation[]) {
    const updated = parseGraphTime(conversation?.updated_time);
    if (!Number.isFinite(updated) || updated < opts.now - SYNC_CONVERSATION_WINDOW_MS) continue;
    for (const message of conversation.messages?.data ?? []) {
      const at = parseGraphTime(message?.created_time);
      const from = message?.from?.id;
      const to = message?.to?.data?.[0]?.id;
      if (typeof message?.id !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
      if (!Number.isFinite(at) || at < opts.notBefore || at > opts.now + 60_000) continue;
      const outbound = from === accountId;
      if (!outbound && to !== accountId) continue;
      const text = typeof message.message === 'string' && message.message ? message.message : '[Attachment]';
      events.push({ accountId, participantId: outbound ? to : from, messageId: message.id, direction: outbound ? 'outbound' : 'inbound', text, at: new Date(at).toISOString() });
    }
  }
  return events;
}

const OUTBOUND_MATCH_WINDOW_MS = 5 * 60_000;

async function isKnownOutbound(admin: SupabaseClient, accountId: string, event: InstagramEvent): Promise<boolean> {
  const at = Date.parse(event.at);
  const { data } = await admin.from('instagram_messages').select('id').eq('account_id', accountId).eq('direction', 'outbound').eq('content', event.text)
    .gte('created_at', new Date(at - OUTBOUND_MATCH_WINDOW_MS).toISOString()).lte('created_at', new Date(at + OUTBOUND_MATCH_WINDOW_MS).toISOString()).limit(1);
  return Boolean(data?.length);
}

const USERNAME_PATTERN = /^[A-Za-z0-9._]{1,30}$/;
/** Profile lookups per connection per tick, for threads the conversations page did not cover. */
const PROFILE_LOOKUPS_PER_TICK = 5;

/** Map participant ID → Instagram username from every message in a conversations page. */
export function conversationUsernames(accountId: string, conversations: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(conversations)) return names;
  for (const conversation of conversations as GraphConversation[]) {
    for (const message of conversation?.messages?.data ?? []) {
      for (const user of [message?.from, ...(message?.to?.data ?? [])]) {
        if (typeof user?.id === 'string' && user.id !== accountId && typeof user.username === 'string' && USERNAME_PATTERN.test(user.username)) names.set(user.id, user.username);
      }
    }
  }
  return names;
}

async function fillUsernames(admin: SupabaseClient, connectionId: string, token: string, known: Map<string, string>) {
  const { data: missing } = await admin.from('instagram_threads').select('participant_id').eq('connection_id', connectionId).is('participant_username', null).order('last_message_at', { ascending: false }).limit(50);
  let lookups = 0;
  for (const { participant_id: participantId } of missing ?? []) {
    let username = known.get(participantId);
    if (!username && lookups < PROFILE_LOOKUPS_PER_TICK) {
      lookups++;
      const response = await fetch(`${GRAPH}/${encodeURIComponent(participantId)}?fields=username`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
      const profile = response?.ok ? await response.json().catch(() => null) : null;
      if (typeof profile?.username === 'string' && USERNAME_PATTERN.test(profile.username)) username = profile.username;
    }
    if (username) await admin.from('instagram_threads').update({ participant_username: username }).eq('connection_id', connectionId).eq('participant_id', participantId).is('participant_username', null);
  }
}

export type InstagramSyncResult = { connections: number; recorded: number; errors: number };

/**
 * Pull recent Instagram DMs through the Graph API. Webhooks are the primary
 * path; this covers accounts whose message webhooks Meta does not deliver
 * (e.g. Standard Access) and any notifications Meta drops.
 */
export async function syncInstagramConversations(admin: SupabaseClient, now = Date.now()): Promise<InstagramSyncResult> {
  const { data: connections, error } = await admin.from('instagram_connections').select('id,account_id,instagram_id,access_token,created_at').not('access_token', 'is', null);
  if (error) throw new Error(error.message);
  const result: InstagramSyncResult = { connections: connections?.length ?? 0, recorded: 0, errors: 0 };
  for (const connection of connections ?? []) {
    try {
      const url = new URL(`${GRAPH}/${encodeURIComponent(connection.instagram_id)}/conversations`);
      url.searchParams.set('platform', 'instagram');
      url.searchParams.set('limit', String(CONVERSATION_LIMIT));
      url.searchParams.set('fields', `updated_time,messages.limit(${MESSAGES_PER_CONVERSATION}){id,created_time,from,to,message}`);
      const token = decrypt(connection.access_token);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        result.errors++;
        console.warn('[instagram sync] conversations request failed', response.status, body?.error?.code ?? '');
        continue;
      }
      const notBefore = Math.max(Date.parse(connection.created_at), now - SYNC_MESSAGE_MAX_AGE_MS);
      const events = conversationsToEvents(connection.instagram_id, body.data, { now, notBefore });
      if (events.length > 0) await recordEvents(admin, connection, events, result);
      // Names are best effort: a failed lookup must not count against message delivery.
      await fillUsernames(admin, connection.id, token, conversationUsernames(connection.instagram_id, body.data)).catch(() => undefined);
    } catch (err) {
      result.errors++;
      console.error('[instagram sync] connection failed', err instanceof Error ? err.name : 'unknown');
    }
  }
  return result;
}

async function recordEvents(admin: SupabaseClient, connection: { id: string; account_id: string }, events: InstagramEvent[], result: InstagramSyncResult) {
  // Skip messages already stored (by webhook or an earlier tick) to avoid a write per message per minute.
  const { data: known, error: knownError } = await admin.from('instagram_messages').select('meta_message_id').eq('account_id', connection.account_id).in('meta_message_id', events.map((e) => e.messageId));
  if (knownError) { result.errors++; return; }
  const seen = new Set((known ?? []).map((row) => row.meta_message_id));
  // Oldest first so thread previews end on the newest message.
  for (const event of events.filter((e) => !seen.has(e.messageId)).sort((a, b) => a.at.localeCompare(b.at))) {
    // Replies sent from our inbox are stored under the Send API's message_id, which may not
    // match the ID this endpoint reports. Treat an outbound message with the same text sent
    // within a few minutes as the same message.
    if (event.direction === 'outbound' && (await isKnownOutbound(admin, connection.account_id, event))) continue;
    const saved = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: event.participantId, p_meta_id: event.messageId, p_direction: event.direction, p_content: event.text, p_at: event.at });
    if (saved.error) { result.errors++; console.error('[instagram sync] message storage failed', saved.error.code); continue; }
    result.recorded++;
  }
}
