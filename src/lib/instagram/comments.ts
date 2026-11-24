import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { parseGraphTime } from './sync';

const GRAPH = 'https://graph.facebook.com/v27.0';
/** Meta accepts a private reply for seven days after the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Upper bound on DMs per connection per run, so a busy post cannot cause a burst. */
export const MAX_REPLIES_PER_RUN = 20;
const RECENT_MEDIA = 10;
const COMMENTS_PER_MEDIA = 50;

export type InstagramComment = { commentId: string; mediaId: string; commenterId: string | null; username: string | null; text: string; at: string; isReply: boolean };
export type CommentRule = { id: string; media_id: string | null; keywords: string[]; reply_text: string; active_since: string | null; created_at: string };
export type CommentConnection = { id: string; account_id: string; instagram_id: string; username: string; access_token: string };

const RULE_FIELDS = 'id,media_id,keywords,reply_text,active_since,created_at';
const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** Whole-word, case-insensitive match. An empty keyword list matches any comment. */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = normalize(text);
  return keywords.some((keyword) => {
    const escaped = normalize(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return escaped !== '' && new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, 'u').test(haystack);
  });
}

/** Rules for one post win over rules for every post; older rules win ties. */
export function pickRule(rules: CommentRule[], comment: InstagramComment, business: { instagram_id: string; username: string }, now: number): CommentRule | null {
  const at = Date.parse(comment.at);
  if (comment.isReply || !Number.isFinite(at) || at > now + 60_000 || now - at >= PRIVATE_REPLY_WINDOW_MS) return null;
  if (comment.commenterId === business.instagram_id || comment.username === business.username) return null;
  const candidates = rules.filter((rule) => rule.active_since !== null && at >= Date.parse(rule.active_since) && (rule.media_id === null || rule.media_id === comment.mediaId) && matchesKeywords(comment.text, rule.keywords));
  candidates.sort((a, b) => Number(a.media_id === null) - Number(b.media_id === null) || a.created_at.localeCompare(b.created_at));
  return candidates[0] ?? null;
}

type GraphComment = { id?: unknown; text?: unknown; timestamp?: unknown; username?: unknown; from?: { id?: unknown; username?: unknown }; parent_id?: unknown };
const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

function toComment(raw: GraphComment, mediaId: string, at: number): InstagramComment | null {
  const commentId = str(raw?.id);
  if (!commentId || !Number.isFinite(at)) return null;
  return { commentId, mediaId, commenterId: str(raw.from?.id), username: str(raw.from?.username) ?? str(raw.username), text: str(raw.text) ?? '', at: new Date(at).toISOString(), isReply: str(raw.parent_id) !== null };
}

/** Comments from a Graph API comments edge. */
export function commentsFromGraph(mediaId: string, data: unknown): InstagramComment[] {
  if (!Array.isArray(data)) return [];
  return (data as GraphComment[]).map((raw) => toComment(raw, mediaId, parseGraphTime(raw?.timestamp))).filter((c): c is InstagramComment => c !== null);
}

/** Comments from a `comments` webhook. The payload has no comment time, so the notification time is used. */
export function parseCommentEvents(body: unknown): (InstagramComment & { accountId: string })[] {
  const payload = body as { object?: unknown; entry?: unknown } | null;
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const comments: (InstagramComment & { accountId: string })[] = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.changes)) continue;
    const time = Number(entry.time);
    const at = time < 1e12 ? time * 1000 : time;
    for (const change of entry.changes) {
      const mediaId = change?.field === 'comments' ? str(change.value?.media?.id) : null;
      const comment = mediaId ? toComment(change.value, mediaId, at > 0 && at < 8.64e15 ? at : Number.NaN) : null;
      if (comment) comments.push({ ...comment, accountId: entry.id });
    }
  }
  return comments;
}

type Outcome = 'sent' | 'failed' | 'unknown' | 'skipped';

async function sendPrivateReply(admin: SupabaseClient, connection: CommentConnection, token: string, rule: CommentRule, comment: InstagramComment): Promise<Outcome> {
  // Reserve first. A unique violation means this comment, or this person on this post, is already handled.
  const { data: claim, error: claimError } = await admin.from('instagram_comment_replies').insert({
    account_id: connection.account_id, connection_id: connection.id, rule_id: rule.id, comment_id: comment.commentId, media_id: comment.mediaId,
    commenter_key: comment.commenterId ?? comment.username ?? comment.commentId, commenter_username: comment.username,
  }).select('id').single();
  if (claimError?.code === '23505') return 'skipped';
  if (claimError || !claim) throw new Error('Could not reserve comment reply');

  let status: Exclude<Outcome, 'skipped'> = 'unknown';
  let detail: string | null = 'No response from Meta. Check Instagram before sending manually.';
  let recipient: string | null = null;
  let messageId: string | null = null;
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(connection.instagram_id)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { comment_id: comment.commentId }, message: { text: rule.reply_text } }), signal: AbortSignal.timeout(20_000) });
    const result = await response.json().catch(() => null);
    messageId = str(result?.message_id);
    recipient = str(result?.recipient_id);
    if (response.ok && messageId) { status = 'sent'; detail = null; }
    else if (result?.error) { status = 'failed'; detail = graphError(result.error); }
  } catch { /* outcome stays unknown: Meta may have accepted it, so it is never resent automatically */ }

  const { error: saveError } = await admin.from('instagram_comment_replies').update({ status, error: detail }).eq('id', claim.id);
  if (saveError) console.error('[instagram comments] could not save outcome', saveError.code);
  if (status === 'sent' && recipient && messageId) {
    const saved = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: recipient, p_meta_id: messageId, p_direction: 'outbound', p_content: rule.reply_text, p_at: new Date().toISOString() });
    if (saved.error) console.error('[instagram comments] could not add reply to inbox', saved.error.code);
    else if (comment.username) await admin.from('instagram_threads').update({ participant_username: comment.username }).eq('connection_id', connection.id).eq('participant_id', recipient).is('participant_username', null);
  }
  return status;
}

export function graphError(error: { message?: unknown; code?: unknown; error_subcode?: unknown }): string {
  const codes = [error.code, error.error_subcode].filter((c) => typeof c === 'number').join('/');
  return `${str(error.message) ?? 'Meta rejected the request'}${codes ? ` (${codes})` : ''}`.slice(0, 300);
}

export type CommentRunResult = { connections: number; sent: number; failed: number; errors: number };
const emptyResult = (): CommentRunResult => ({ connections: 0, sent: 0, failed: 0, errors: 0 });

/** Send at most one private reply per matching comment. */
export async function replyToComments(admin: SupabaseClient, connection: CommentConnection, rules: CommentRule[], comments: InstagramComment[], now = Date.now()): Promise<CommentRunResult> {
  const result = emptyResult();
  const matched = comments.map((comment) => ({ comment, rule: pickRule(rules, comment, connection, now) })).filter((m): m is { comment: InstagramComment; rule: CommentRule } => m.rule !== null);
  if (matched.length === 0) return result;
  // Skip handled comments up front so they do not use up the per-run limit.
  const { data: handled, error } = await admin.from('instagram_comment_replies').select('comment_id').eq('connection_id', connection.id).in('comment_id', matched.map((m) => m.comment.commentId));
  if (error) throw new Error(error.message);
  const done = new Set((handled ?? []).map((row) => row.comment_id));
  const token = decrypt(connection.access_token);
  let attempts = 0;
  for (const { comment, rule } of matched.filter((m) => !done.has(m.comment.commentId)).sort((a, b) => a.comment.at.localeCompare(b.comment.at))) {
    if (attempts >= MAX_REPLIES_PER_RUN) break;
    const outcome = await sendPrivateReply(admin, connection, token, rule, comment);
    if (outcome === 'skipped') continue;
    attempts++;
    if (outcome === 'sent') result.sent++; else result.failed++;
  }
  return result;
}

export async function activeRules(admin: SupabaseClient, connectionId: string): Promise<CommentRule[]> {
  const { data, error } = await admin.from('instagram_comment_rules').select(RULE_FIELDS).eq('connection_id', connectionId).not('active_since', 'is', null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function graphGet(token: string, path: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(graphError(body?.error ?? {}));
  return body;
}

const COMMENT_FIELDS = 'id,text,timestamp,username,from,parent_id';

async function fetchComments(connection: CommentConnection, rules: CommentRule[]): Promise<InstagramComment[]> {
  const token = decrypt(connection.access_token);
  const comments: InstagramComment[] = [];
  for (const mediaId of new Set(rules.map((r) => r.media_id).filter((id): id is string => id !== null))) {
    const body = await graphGet(token, `${encodeURIComponent(mediaId)}/comments`, { fields: COMMENT_FIELDS, limit: String(COMMENTS_PER_MEDIA) });
    comments.push(...commentsFromGraph(mediaId, body.data));
  }
  if (rules.some((r) => r.media_id === null)) {
    const body = await graphGet(token, `${encodeURIComponent(connection.instagram_id)}/media`, { fields: `id,comments.limit(${COMMENTS_PER_MEDIA}){${COMMENT_FIELDS}}`, limit: String(RECENT_MEDIA) });
    for (const media of Array.isArray(body.data) ? body.data : []) if (str(media?.id)) comments.push(...commentsFromGraph(media.id, media.comments?.data));
  }
  return [...new Map(comments.map((c) => [c.commentId, c])).values()];
}

/** Minute check that covers comment webhooks Meta does not deliver. Only runs for connections with a rule switched on. */
export async function checkInstagramComments(admin: SupabaseClient, now = Date.now()): Promise<CommentRunResult> {
  const total = emptyResult();
  const { data: active, error: activeError } = await admin.from('instagram_comment_rules').select('connection_id').not('active_since', 'is', null);
  if (activeError) throw new Error(activeError.message);
  const ids = [...new Set((active ?? []).map((row) => row.connection_id as string))];
  if (ids.length === 0) return total;
  const { data: connections, error } = await admin.from('instagram_connections').select('id,account_id,instagram_id,username,access_token').in('id', ids).not('access_token', 'is', null);
  if (error) throw new Error(error.message);
  for (const connection of (connections ?? []) as CommentConnection[]) {
    total.connections++;
    let lastError: string | null = null;
    try {
      const rules = await activeRules(admin, connection.id);
      const run = await replyToComments(admin, connection, rules, await fetchComments(connection, rules), now);
      total.sent += run.sent;
      total.failed += run.failed;
    } catch (err) {
      total.errors++;
      lastError = (err instanceof Error ? err.message : 'Comment check failed').slice(0, 300);
      console.error('[instagram comments] check failed for connection', connection.id);
    }
    await admin.from('instagram_comment_rules').update({ last_checked_at: new Date(now).toISOString(), last_error: lastError }).eq('connection_id', connection.id).not('active_since', 'is', null);
  }
  return total;
}
