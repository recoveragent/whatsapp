import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { buildProductCards, CARD_PLACEHOLDER, cardMessage } from './cards';
import { CONNECTION_FIELDS, graphPost, isPaused, pauseComments, pauseFor, type CommentConnection } from './comments';

const HOUR_MS = 60 * 60_000;
/** Taps on older cards are still answered, but not indefinitely. */
const TAP_WAIT_MS = 7 * 24 * HOUR_MS;
/** A tap allows messages for 24 hours; stop a little earlier. */
export const FOLLOW_UP_WINDOW_MS = 23.5 * HOUR_MS;
const BATCH = 20;
const PENDING = 200;

type FlowReply = {
  id: string; account_id: string; connection_id: string; recipient_id: string | null; created_at: string; product_ids: number[]; fallback_text: string | null;
  tap_label: string | null; tapped_at: string | null; products_sent_at: string | null; reminder_text: string | null; reminder_minutes: number | null;
};
const FIELDS = 'id,account_id,connection_id,recipient_id,created_at,product_ids,fallback_text,tap_label,tapped_at,products_sent_at,reminder_text,reminder_minutes';

type Thread = { id: string; connection_id: string; participant_id: string };
async function threadsFor(admin: SupabaseClient, rows: FlowReply[]): Promise<Map<string, Thread>> {
  const { data, error } = await admin.from('instagram_threads').select('id,connection_id,participant_id').in('connection_id', [...new Set(rows.map((r) => r.connection_id))]).in('participant_id', [...new Set(rows.map((r) => r.recipient_id!))]);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((t: Thread) => [`${t.connection_id}:${t.participant_id}`, t]));
}
const keyOf = (row: FlowReply) => `${row.connection_id}:${row.recipient_id}`;

/** Match stored customer messages to cards waiting for a tap. Each message answers at most one card, the newest before it. */
export async function recordTaps(admin: SupabaseClient, now: number): Promise<number> {
  const { data, error } = await admin.from('instagram_comment_replies').select(FIELDS).eq('delivery', 'tap').eq('status', 'sent').is('tapped_at', null).gte('created_at', new Date(now - TAP_WAIT_MS).toISOString()).order('created_at', { ascending: false }).limit(PENDING);
  if (error) throw new Error(error.message);
  const waiting = ((data ?? []) as FlowReply[]).filter((r) => r.recipient_id && r.tap_label);
  if (waiting.length === 0) return 0;
  const threads = await threadsFor(admin, waiting);
  const byThread = new Map<string, FlowReply[]>();
  for (const row of waiting) {
    const thread = threads.get(keyOf(row));
    if (thread) byThread.set(thread.id, [...(byThread.get(thread.id) ?? []), row]);
  }
  if (byThread.size === 0) return 0;
  const since = waiting.reduce((min, r) => (r.created_at < min ? r.created_at : min), waiting[0].created_at);
  const { data: messages, error: messageError } = await admin.from('instagram_messages').select('id,thread_id,content,created_at').in('thread_id', [...byThread.keys()]).eq('direction', 'inbound').in('content', [...new Set(waiting.map((r) => r.tap_label!))]).gte('created_at', since).order('created_at', { ascending: true }).limit(500);
  if (messageError) throw new Error(messageError.message);
  if (!messages || messages.length === 0) return 0;
  const { data: used, error: usedError } = await admin.from('instagram_comment_replies').select('tap_message_id').in('tap_message_id', messages.map((m) => m.id));
  if (usedError) throw new Error(usedError.message);
  const taken = new Set((used ?? []).map((u) => u.tap_message_id));
  let taps = 0;
  for (const message of messages) {
    if (taken.has(message.id)) continue;
    const rows = byThread.get(message.thread_id) ?? [];
    const row = rows.filter((r) => r.tap_label === message.content && Date.parse(r.created_at) <= Date.parse(message.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!row) continue;
    const { data: saved, error: saveError } = await admin.from('instagram_comment_replies').update({ tapped_at: message.created_at, tap_message_id: message.id }).eq('id', row.id).is('tapped_at', null).select('id').maybeSingle();
    if (saveError || !saved) continue;
    byThread.set(message.thread_id, rows.filter((r) => r !== row));
    taps++;
  }
  return taps;
}

async function usableConnection(admin: SupabaseClient, cache: Map<string, CommentConnection | null>, id: string, now: number): Promise<CommentConnection | null> {
  if (!cache.has(id)) {
    const { data, error } = await admin.from('instagram_connections').select(CONNECTION_FIELDS).eq('id', id).not('access_token', 'is', null).maybeSingle();
    if (error) throw new Error(error.message);
    cache.set(id, (data as CommentConnection | null) ?? null);
  }
  const connection = cache.get(id) ?? null;
  return connection && !isPaused(connection.comments_paused_until, now) ? connection : null;
}

async function deliver(admin: SupabaseClient, connection: CommentConnection, recipientId: string, message: unknown, inboxText: string, now: number) {
  const attempt = await graphPost(decrypt(connection.access_token), `${encodeURIComponent(connection.instagram_id)}/messages`, { recipient: { id: recipientId }, message });
  const messageId = typeof attempt.body?.message_id === 'string' ? attempt.body.message_id : null;
  if (attempt.status === 'sent' && !messageId) { attempt.status = 'unknown'; attempt.detail = 'Meta did not confirm the message.'; }
  if (attempt.status === 'sent') {
    const saved = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: recipientId, p_meta_id: messageId, p_direction: 'outbound', p_content: inboxText, p_at: new Date().toISOString() });
    if (saved.error) console.error('[instagram flows] could not add message to inbox', saved.error.code);
  } else {
    const pause = pauseFor(attempt.code);
    if (pause) await pauseComments(admin, connection, new Date(now + pause.ms).toISOString(), pause.reason);
  }
  return attempt;
}

export type FlowRunResult = { taps: number; products: number; reminders: number; failed: number };

export async function processCommentFlows(admin: SupabaseClient, now = Date.now()): Promise<FlowRunResult> {
  const result: FlowRunResult = { taps: await recordTaps(admin, now), products: 0, reminders: 0, failed: 0 };
  const cache = new Map<string, CommentConnection | null>();
  const windowStart = new Date(now - FOLLOW_UP_WINDOW_MS).toISOString();

  const { data: tapped, error } = await admin.from('instagram_comment_replies').select(FIELDS).eq('delivery', 'tap').eq('status', 'sent').is('products_status', null).not('tapped_at', 'is', null).gte('tapped_at', windowStart).order('tapped_at', { ascending: true }).limit(BATCH);
  if (error) throw new Error(error.message);
  for (const row of (tapped ?? []) as FlowReply[]) {
    const connection = await usableConnection(admin, cache, row.connection_id, now);
    if (!connection || !row.recipient_id) continue;
    // Reserve first: a crash leaves it as 'sending' rather than risking a second copy.
    const { data: claim, error: claimError } = await admin.from('instagram_comment_replies').update({ products_status: 'sending' }).eq('id', row.id).is('products_status', null).select('id').maybeSingle();
    if (claimError || !claim) continue;
    const cards = await buildProductCards(admin, row.account_id, row.product_ids, row.id).catch(() => []);
    if (cards.length === 0 && !row.fallback_text) {
      await admin.from('instagram_comment_replies').update({ products_status: 'failed', products_error: 'No product is available to show.' }).eq('id', row.id);
      result.failed++;
      continue;
    }
    const attempt = cards.length > 0 ? await deliver(admin, connection, row.recipient_id, cardMessage(cards), CARD_PLACEHOLDER, now) : await deliver(admin, connection, row.recipient_id, { text: row.fallback_text }, row.fallback_text!, now);
    await admin.from('instagram_comment_replies').update({ products_status: attempt.status, products_error: attempt.detail, products_sent_at: attempt.status === 'sent' ? new Date(now).toISOString() : null }).eq('id', row.id);
    if (attempt.status === 'sent') result.products++; else result.failed++;
  }

  const { data: remindable, error: remindError } = await admin.from('instagram_comment_replies').select(FIELDS).eq('products_status', 'sent').is('reminder_status', null).not('reminder_text', 'is', null).gte('tapped_at', new Date(now - 48 * HOUR_MS).toISOString()).order('tapped_at', { ascending: true }).limit(PENDING);
  if (remindError) throw new Error(remindError.message);
  const due = ((remindable ?? []) as FlowReply[]).filter((r) => r.recipient_id && r.tapped_at && r.products_sent_at && Date.parse(r.tapped_at) + (r.reminder_minutes ?? 0) * 60_000 <= now).slice(0, BATCH);
  if (due.length === 0) return result;
  const threads = await threadsFor(admin, due);
  for (const row of due) {
    const skip = (reason: string) => admin.from('instagram_comment_replies').update({ reminder_status: 'skipped', reminder_error: reason }).eq('id', row.id).is('reminder_status', null);
    if (now - Date.parse(row.tapped_at!) > FOLLOW_UP_WINDOW_MS) { await skip('The 24-hour reply window closed first.'); continue; }
    const connection = await usableConnection(admin, cache, row.connection_id, now);
    const thread = threads.get(keyOf(row));
    if (!connection || !thread) continue;
    const { data: later, error: laterError } = await admin.from('instagram_messages').select('direction,content,created_at').eq('thread_id', thread.id).gt('created_at', row.tapped_at!).limit(50);
    if (laterError) continue;
    const customerWrote = (later ?? []).some((m) => m.direction === 'inbound' && m.content !== row.tap_label);
    // Allow two minutes for the stored copy of our own product cards.
    const teamWrote = (later ?? []).some((m) => m.direction === 'outbound' && Date.parse(m.created_at) > Date.parse(row.products_sent_at!) + 2 * 60_000);
    if (customerWrote || teamWrote) { await skip(customerWrote ? 'The customer replied.' : 'Your team already messaged them.'); continue; }
    const { data: claim, error: claimError } = await admin.from('instagram_comment_replies').update({ reminder_status: 'sending' }).eq('id', row.id).is('reminder_status', null).select('id').maybeSingle();
    if (claimError || !claim) continue;
    const attempt = await deliver(admin, connection, row.recipient_id!, { text: row.reminder_text }, row.reminder_text!, now);
    await admin.from('instagram_comment_replies').update({ reminder_status: attempt.status, reminder_error: attempt.detail }).eq('id', row.id);
    if (attempt.status === 'sent') result.reminders++; else result.failed++;
  }
  return result;
}
