import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { parseGraphTime } from './sync';

const GRAPH = 'https://graph.facebook.com/v27.0';
const HOUR_MS = 60 * 60_000;
/** Meta accepts a private reply for seven days after the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * HOUR_MS;
/** Upper bound on DMs per connection per run, so a busy post cannot cause a burst. */
export const MAX_REPLIES_PER_RUN = 20;
/** Meta allows 750 private replies per account per hour; stay below it across webhook and minute runs. */
export const MAX_REPLIES_PER_HOUR = 600;
/** Consecutive rejected or unconfirmed sends before the account is paused. */
export const FAILURES_BEFORE_PAUSE = 5;
const RECENT_MEDIA = 10;
const COMMENTS_PER_MEDIA = 50;

export type InstagramComment = { commentId: string; mediaId: string; commenterId: string | null; username: string | null; text: string; at: string; isReply: boolean };
export type MatchMode = 'word' | 'contains';
export type CommentRule = {
  id: string; media_id: string | null; keywords: string[]; exclude_keywords: string[]; match_mode: MatchMode; skip_mentions: boolean;
  public_replies: string[]; public_reply_limit: number; reply_text: string; active_since: string | null; created_at: string;
};
export type CommentConnection = {
  id: string; account_id: string; instagram_id: string; username: string; access_token: string;
  comments_paused_until: string | null; comments_ignore_before: string | null; public_replies_paused_until: string | null;
};
/** Columns every caller must load for a CommentConnection. */
export const CONNECTION_FIELDS = 'id,account_id,instagram_id,username,access_token,comments_paused_until,comments_ignore_before,public_replies_paused_until';
const RULE_FIELDS = 'id,media_id,keywords,exclude_keywords,match_mode,skip_mentions,public_replies,public_reply_limit,reply_text,active_since,created_at';

const tidy = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Case-insensitive match on whole words, or anywhere in the text. An empty keyword list matches any comment. */
export function matchesKeywords(text: string, keywords: string[], mode: MatchMode = 'word'): boolean {
  if (keywords.length === 0) return true;
  const haystack = tidy(text);
  return keywords.some((raw) => {
    const keyword = tidy(raw);
    if (!keyword) return false;
    if (mode === 'contains') return haystack.includes(keyword);
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, 'u').test(haystack);
  });
}

/** True when the comment tags an account other than the business itself. */
export function mentionsOthers(text: string, businessUsername: string): boolean {
  return [...text.matchAll(/(?<![\p{L}\p{N}._])@([A-Za-z0-9._]+)/gu)].some((m) => {
    const name = m[1].replace(/\.+$/, '').toLowerCase();
    return name !== '' && name !== businessUsername.toLowerCase();
  });
}

type Business = Pick<CommentConnection, 'instagram_id' | 'username' | 'comments_ignore_before'>;

/** Rules for one post win over rules for every post; older rules win ties. */
export function pickRule(rules: CommentRule[], comment: InstagramComment, business: Business, now: number): CommentRule | null {
  const at = Date.parse(comment.at);
  if (comment.isReply || !Number.isFinite(at) || at > now + 60_000 || now - at >= PRIVATE_REPLY_WINDOW_MS) return null;
  if (business.comments_ignore_before && at < Date.parse(business.comments_ignore_before)) return null;
  if (comment.commenterId === business.instagram_id || comment.username === business.username) return null;
  const candidates = rules.filter((rule) => rule.active_since !== null && at >= Date.parse(rule.active_since)
    && (rule.media_id === null || rule.media_id === comment.mediaId)
    && matchesKeywords(comment.text, rule.keywords, rule.match_mode)
    && !(rule.exclude_keywords.length > 0 && matchesKeywords(comment.text, rule.exclude_keywords, rule.match_mode))
    && !(rule.skip_mentions && mentionsOthers(comment.text, business.username)));
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

type GraphErrorBody = { message?: unknown; code?: unknown; error_subcode?: unknown };
type Status = 'sent' | 'failed' | 'unknown';
type Attempt = { status: Status; code: number | null; detail: string | null; body: Record<string, unknown> | null };

export function graphError(error: GraphErrorBody): string {
  const codes = [error.code, error.error_subcode].filter((c) => typeof c === 'number').join('/');
  return `${str(error.message) ?? 'Meta rejected the request'}${codes ? ` (${codes})` : ''}`.slice(0, 300);
}

async function graphPost(token: string, path: string, body: unknown): Promise<Attempt> {
  try {
    const response = await fetch(`${GRAPH}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const result = await response.json().catch(() => null);
    if (result?.error) return { status: 'failed', code: typeof result.error.code === 'number' ? result.error.code : null, detail: graphError(result.error), body: null };
    if (response.ok && result) return { status: 'sent', code: null, detail: null, body: result };
  } catch { /* Meta may have accepted it, so the outcome is unknown and it is never retried */ }
  return { status: 'unknown', code: null, detail: 'No response from Meta. Check Instagram before sending manually.', body: null };
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613, 80001, 80002, 80006]);

/** How long to pause after one rejected request, or null when a single failure is not a reason to pause. */
export function pauseFor(code: number | null): { ms: number; reason: string } | null {
  if (code === 368) return { ms: 24 * HOUR_MS, reason: 'Instagram temporarily blocked this account for policy reasons.' };
  if (code === 190 || code === 102) return { ms: 24 * HOUR_MS, reason: 'Instagram login is no longer valid. Reconnect Instagram.' };
  if (code !== null && RATE_LIMIT_CODES.has(code)) return { ms: HOUR_MS, reason: 'Meta limited how fast this account can send.' };
  return null;
}

const isPaused = (until: string | null, now: number) => until !== null && Date.parse(until) > now;

async function pauseComments(admin: SupabaseClient, connection: CommentConnection, until: string, reason: string) {
  connection.comments_paused_until = until;
  connection.comments_ignore_before = until;
  const { error } = await admin.from('instagram_connections').update({ comments_paused_until: until, comments_ignore_before: until, comments_pause_reason: reason.slice(0, 400) }).eq('id', connection.id);
  if (error) console.error('[instagram comments] could not save pause', error.code);
}

async function pausePublicReplies(admin: SupabaseClient, connection: CommentConnection, until: string) {
  connection.public_replies_paused_until = until;
  const { error } = await admin.from('instagram_connections').update({ public_replies_paused_until: until }).eq('id', connection.id);
  if (error) console.error('[instagram comments] could not save public reply pause', error.code);
}

/** True when the latest attempts since the last pause or resume were all rejected or unconfirmed. */
async function failingStreak(admin: SupabaseClient, connection: CommentConnection, column: 'status' | 'public_status', since: string | null): Promise<boolean> {
  const { data } = await admin.from('instagram_comment_replies').select('status,public_status').eq('connection_id', connection.id).gte('created_at', since ?? '1970-01-01T00:00:00Z').in(column, ['sent', 'failed', 'unknown']).order('created_at', { ascending: false }).limit(FAILURES_BEFORE_PAUSE);
  return data?.length === FAILURES_BEFORE_PAUSE && data.every((row) => row[column] !== 'sent');
}

async function sendPublicReply(admin: SupabaseClient, connection: CommentConnection, token: string, rule: CommentRule, comment: InstagramComment, replyId: string, now: number) {
  if (rule.public_replies.length === 0 || isPaused(connection.public_replies_paused_until, now)) return;
  const { count, error } = await admin.from('instagram_comment_replies').select('id', { count: 'exact', head: true }).eq('connection_id', connection.id).eq('media_id', comment.mediaId).not('public_status', 'is', null);
  if (error || (count ?? 0) >= rule.public_reply_limit) return;
  // Reserved as unconfirmed first, so a crash cannot lead to a second public reply.
  const { error: reserveError } = await admin.from('instagram_comment_replies').update({ public_status: 'unknown' }).eq('id', replyId);
  if (reserveError) return;
  const message = rule.public_replies[Math.floor(Math.random() * rule.public_replies.length)];
  const attempt = await graphPost(token, `${encodeURIComponent(comment.commentId)}/replies`, { message });
  await admin.from('instagram_comment_replies').update({ public_status: attempt.status, public_error: attempt.detail }).eq('id', replyId);
  if (attempt.status === 'sent') return;
  const pause = pauseFor(attempt.code);
  if (pause && attempt.code === 368) await pauseComments(admin, connection, new Date(now + pause.ms).toISOString(), pause.reason);
  else if (pause || await failingStreak(admin, connection, 'public_status', latest(connection.comments_ignore_before, connection.public_replies_paused_until))) await pausePublicReplies(admin, connection, new Date(now + (pause?.ms ?? 24 * HOUR_MS)).toISOString());
}

const latest = (a: string | null, b: string | null) => (a && b ? (Date.parse(a) > Date.parse(b) ? a : b) : a ?? b);

async function sendPrivateReply(admin: SupabaseClient, connection: CommentConnection, token: string, rule: CommentRule, comment: InstagramComment, now: number): Promise<Status | 'skipped'> {
  // Reserve first. A unique violation means this comment, or this person on this post, is already handled.
  const { data: claim, error: claimError } = await admin.from('instagram_comment_replies').insert({
    account_id: connection.account_id, connection_id: connection.id, rule_id: rule.id, comment_id: comment.commentId, media_id: comment.mediaId,
    commenter_key: comment.commenterId ?? comment.username ?? comment.commentId, commenter_username: comment.username,
  }).select('id').single();
  if (claimError?.code === '23505') return 'skipped';
  if (claimError || !claim) throw new Error('Could not reserve comment reply');

  const attempt = await graphPost(token, `${encodeURIComponent(connection.instagram_id)}/messages`, { recipient: { comment_id: comment.commentId }, message: { text: rule.reply_text } });
  const messageId = str(attempt.body?.message_id);
  const recipient = str(attempt.body?.recipient_id);
  if (attempt.status === 'sent' && !messageId) { attempt.status = 'unknown'; attempt.detail = 'Meta did not confirm the message.'; }
  const { error: saveError } = await admin.from('instagram_comment_replies').update({ status: attempt.status, error: attempt.detail }).eq('id', claim.id);
  if (saveError) console.error('[instagram comments] could not save outcome', saveError.code);

  if (attempt.status !== 'sent') {
    const pause = pauseFor(attempt.code) ?? (await failingStreak(admin, connection, 'status', connection.comments_ignore_before)
      ? { ms: 24 * HOUR_MS, reason: `${FAILURES_BEFORE_PAUSE} messages in a row were not delivered. Last reason: ${attempt.detail}` } : null);
    if (pause) await pauseComments(admin, connection, new Date(now + pause.ms).toISOString(), pause.reason);
    return attempt.status;
  }
  if (recipient && messageId) {
    const saved = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: recipient, p_meta_id: messageId, p_direction: 'outbound', p_content: rule.reply_text, p_at: new Date().toISOString() });
    if (saved.error) console.error('[instagram comments] could not add reply to inbox', saved.error.code);
    else if (comment.username) await admin.from('instagram_threads').update({ participant_username: comment.username }).eq('connection_id', connection.id).eq('participant_id', recipient).is('participant_username', null);
  }
  // Only after the DM is confirmed, so a public "check your DMs" is never untrue.
  await sendPublicReply(admin, connection, token, rule, comment, claim.id, now);
  return 'sent';
}

export type CommentRunResult = { connections: number; sent: number; failed: number; errors: number };
const emptyResult = (): CommentRunResult => ({ connections: 0, sent: 0, failed: 0, errors: 0 });

/** Send at most one private reply per matching comment. */
export async function replyToComments(admin: SupabaseClient, connection: CommentConnection, rules: CommentRule[], comments: InstagramComment[], now = Date.now()): Promise<CommentRunResult> {
  const result = emptyResult();
  if (isPaused(connection.comments_paused_until, now)) return result;
  const matched = comments.map((comment) => ({ comment, rule: pickRule(rules, comment, connection, now) })).filter((m): m is { comment: InstagramComment; rule: CommentRule } => m.rule !== null);
  if (matched.length === 0) return result;
  // Skip handled comments up front so they do not use up the per-run limit.
  const { data: handled, error } = await admin.from('instagram_comment_replies').select('comment_id').eq('connection_id', connection.id).in('comment_id', matched.map((m) => m.comment.commentId));
  if (error) throw new Error(error.message);
  const done = new Set((handled ?? []).map((row) => row.comment_id));
  const waiting = matched.filter((m) => !done.has(m.comment.commentId)).sort((a, b) => a.comment.at.localeCompare(b.comment.at));
  if (waiting.length === 0) return result;
  const { count, error: countError } = await admin.from('instagram_comment_replies').select('id', { count: 'exact', head: true }).eq('connection_id', connection.id).gte('created_at', new Date(now - HOUR_MS).toISOString());
  if (countError) throw new Error(countError.message);
  const budget = Math.min(MAX_REPLIES_PER_RUN, MAX_REPLIES_PER_HOUR - (count ?? 0));
  const token = decrypt(connection.access_token);
  let attempts = 0;
  for (const { comment, rule } of waiting) {
    if (attempts >= budget || isPaused(connection.comments_paused_until, now)) break;
    const outcome = await sendPrivateReply(admin, connection, token, rule, comment, now);
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
  const { data: connections, error } = await admin.from('instagram_connections').select(CONNECTION_FIELDS).in('id', ids).not('access_token', 'is', null);
  if (error) throw new Error(error.message);
  for (const connection of (connections ?? []) as CommentConnection[]) {
    if (isPaused(connection.comments_paused_until, now)) continue;
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
