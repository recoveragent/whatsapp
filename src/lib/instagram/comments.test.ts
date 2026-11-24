import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommentRuleInput } from './comment-rule-input';
import { checkInstagramComments, commentsFromGraph, FAILURES_BEFORE_PAUSE, matchesKeywords, MAX_REPLIES_PER_HOUR, MAX_REPLIES_PER_RUN, mentionsOthers, parseCommentEvents, pauseFor, pickRule, replyToComments, type CommentConnection, type CommentRule, type InstagramComment } from './comments';
import { testAdmin, type Row } from './test-admin';

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
afterEach(() => vi.unstubAllGlobals());

const NOW = Date.parse('2026-11-24T10:00:00Z');
const business = { instagram_id: '123', username: 'store', comments_ignore_before: null };
const connection = (over: Partial<CommentConnection> = {}): CommentConnection => ({ id: 'c1', account_id: 'a1', access_token: 'token', ...business, comments_paused_until: null, public_replies_paused_until: null, ...over });
const rule = (over: Partial<CommentRule> = {}): CommentRule => ({ id: 'r1', media_id: null, keywords: ['price'], exclude_keywords: [], match_mode: 'word', skip_mentions: true, public_replies: [], public_reply_limit: 100, reply_text: 'Here you go', active_since: '2026-11-24T09:00:00Z', created_at: '2026-11-24T08:00:00Z', ...over });
const comment = (over: Partial<InstagramComment> = {}): InstagramComment => ({ commentId: 'k1', mediaId: 'm1', commenterId: '456', username: 'alice', text: 'Price please', at: '2026-11-24T09:30:00Z', isReply: false, ...over });
const people = (n: number) => Array.from({ length: n }, (_, i) => comment({ commentId: `k${i}`, commenterId: `p${i}`, at: new Date(NOW - 60_000 + i).toISOString() }));

describe('matching', () => {
  it('matches whole words in any case, phrases and other scripts', () => {
    expect(matchesKeywords('What is the PRICE?', ['price'])).toBe(true);
    expect(matchesKeywords('priceless', ['price'])).toBe(false);
    expect(matchesKeywords('send   me the link', ['send me'])).toBe(true);
    expect(matchesKeywords('कीमत क्या है', ['कीमत'])).toBe(true);
    expect(matchesKeywords('c++ rocks', ['c++'])).toBe(true);
    expect(matchesKeywords('anything', [])).toBe(true);
    expect(matchesKeywords('anything', ['  '])).toBe(false);
  });
  it('can match anywhere in the comment', () => {
    expect(matchesKeywords('Plzz', ['plz'], 'contains')).toBe(true);
    expect(matchesKeywords('Plzz', ['plz'])).toBe(false);
    expect(matchesKeywords('abc', ['a.c'], 'contains')).toBe(false);
  });
  it('recognises tags of other accounts only', () => {
    expect(mentionsOthers('look @friend.name', 'store')).toBe(true);
    expect(mentionsOthers('@Store price?', 'store')).toBe(false);
    expect(mentionsOthers('thanks @store.', 'store')).toBe(false);
    expect(mentionsOthers('mail me a@b.com', 'store')).toBe(false);
    expect(mentionsOthers('@store and @bob', 'store')).toBe(true);
  });
});

describe('rule selection', () => {
  it('prefers a rule for the specific post', () => {
    expect(pickRule([rule(), rule({ id: 'r2', media_id: 'm1', created_at: '2026-11-24T08:30:00Z' })], comment(), business, NOW)?.id).toBe('r2');
  });
  it('never answers earlier, expired, own, nested, blocked or tagging comments, or while off', () => {
    const none = (c: Partial<InstagramComment>, r: Partial<CommentRule> = {}, b: Partial<typeof business> & { comments_ignore_before?: string | null } = {}) => expect(pickRule([rule(r)], comment(c), { ...business, ...b }, NOW)).toBeNull();
    none({ at: '2026-11-24T08:59:59Z' });
    none({ at: '2026-11-17T09:00:00Z' }, { active_since: '2026-11-01T00:00:00Z' });
    none({ commenterId: '123' });
    none({ commenterId: null, username: 'store' });
    none({ isReply: true });
    none({}, { active_since: null });
    none({}, { media_id: 'other' });
    none({ at: 'invalid' });
    none({ text: 'Price is horrible' }, { exclude_keywords: ['horrible'] });
    none({ text: 'Price @bob' });
    const ignoring = { instagram_id: '123', username: 'store', comments_ignore_before: '2026-11-24T09:45:00Z' };
    expect(pickRule([rule()], comment(), ignoring, NOW)).toBeNull();
  });
  it('answers a tagging comment when the rule allows it, and ignores empty block lists', () => {
    expect(pickRule([rule({ skip_mentions: false })], comment({ text: 'Price @bob' }), business, NOW)?.id).toBe('r1');
    expect(pickRule([rule({ exclude_keywords: [] })], comment(), business, NOW)?.id).toBe('r1');
  });
});

describe('comment parsing', () => {
  it('reads Graph and webhook comments', () => {
    expect(commentsFromGraph('m1', [{ id: 'k1', text: 'Price', timestamp: '2026-11-24T09:30:00+0000', from: { id: '456', username: 'alice' } }, { text: 'no id' }])).toEqual([comment({ text: 'Price', at: '2026-11-24T09:30:00.000Z' })]);
    const value = { id: 'k1', text: 'Price', from: { id: '456', username: 'alice' }, media: { id: 'm1' } };
    const events = parseCommentEvents({ object: 'instagram', entry: [{ id: '123', time: 1795512600, changes: [{ field: 'comments', value }, { field: 'messages', value }, { field: 'comments', value: { id: 'x' } }] }] });
    expect(events).toEqual([{ ...comment({ text: 'Price', at: new Date(1795512600000).toISOString() }), accountId: '123' }]);
    expect(parseCommentEvents(null)).toEqual([]);
  });
});

const UNIQUE = { instagram_comment_replies: [['connection_id', 'comment_id'], ['connection_id', 'media_id', 'commenter_key']] };
function setup(over: Partial<CommentConnection> = {}, replies: Row[] = []) {
  const conn = connection(over);
  const t = testAdmin({ instagram_connections: [{ ...conn }], instagram_comment_replies: replies, instagram_comment_rules: [], instagram_threads: [] }, { unique: UNIQUE });
  return { ...t, conn, replies: t.tables.instagram_comment_replies, saved: t.tables.instagram_connections[0] };
}
const ok = () => new Response(JSON.stringify({ recipient_id: '456', message_id: 'mid' }));
const failure = (code: number) => new Response(JSON.stringify({ error: { message: 'Not allowed', code } }), { status: 400 });
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const stubFetch = (handler: Handler) => { const f = vi.fn(async (url: string | URL, init?: RequestInit) => handler(String(url), init)); vi.stubGlobal('fetch', f); return f; };

describe('sending', () => {
  it('sends one DM by comment ID, records it, and never repeats it', async () => {
    const send = stubFetch(ok);
    const { admin, conn, replies, calls } = setup();
    expect((await replyToComments(admin, conn, [rule()], [comment()], NOW)).sent).toBe(1);
    expect((await replyToComments(admin, conn, [rule()], [comment(), comment({ commentId: 'k2' })], NOW)).sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ recipient: { comment_id: 'k1' }, message: { text: 'Here you go' } });
    expect(replies[0].status).toBe('sent');
    expect(calls[0]).toMatchObject({ p_participant: '456', p_meta_id: 'mid', p_direction: 'outbound' });
  });

  it('sends once when webhook and minute check run together', async () => {
    const send = stubFetch(ok);
    const { admin, conn } = setup();
    await Promise.all([replyToComments(admin, conn, [rule()], [comment()], NOW), replyToComments(admin, conn, [rule()], [comment()], NOW)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('saves the reason Meta gives, does not retry, and does not pause for one refusal', async () => {
    const send = stubFetch(() => failure(10));
    const { admin, conn, replies, calls, saved } = setup();
    await replyToComments(admin, conn, [rule()], [comment()], NOW);
    await replyToComments(admin, conn, [rule()], [comment()], NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replies[0]).toMatchObject({ status: 'failed', error: 'Not allowed (10)' });
    expect(calls).toEqual([]);
    expect(saved.comments_paused_until).toBeNull();
  });

  it('marks a lost response as unconfirmed and never resends it', async () => {
    const send = stubFetch(() => { throw new Error('timeout'); });
    const { admin, conn, replies } = setup();
    await replyToComments(admin, conn, [rule()], [comment()], NOW);
    await replyToComments(admin, conn, [rule()], [comment()], NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replies[0].status).toBe('unknown');
  });

  it('limits each run and continues with the rest next time', async () => {
    stubFetch(ok);
    const { admin, conn } = setup();
    const many = people(MAX_REPLIES_PER_RUN + 5);
    expect((await replyToComments(admin, conn, [rule()], many, NOW)).sent).toBe(MAX_REPLIES_PER_RUN);
    expect((await replyToComments(admin, conn, [rule()], many, NOW)).sent).toBe(5);
  });

  it('stays under the hourly limit', async () => {
    stubFetch(ok);
    const earlier = Array.from({ length: MAX_REPLIES_PER_HOUR - 2 }, (_, i) => ({ id: `e${i}`, connection_id: 'c1', comment_id: `old${i}`, media_id: 'x', commenter_key: `o${i}`, status: 'sent', created_at: new Date(NOW - 30 * 60_000).toISOString() }));
    const { admin, conn } = setup({}, earlier);
    expect((await replyToComments(admin, conn, [rule()], people(10), NOW)).sent).toBe(2);
    expect((await replyToComments(admin, conn, [rule()], people(10), NOW)).sent).toBe(0);
  });
});

describe('pausing', () => {
  it('classifies Meta errors', () => {
    expect(pauseFor(368)?.ms).toBe(24 * 3600_000);
    expect(pauseFor(613)?.ms).toBe(3600_000);
    expect(pauseFor(190)?.reason).toContain('Reconnect');
    expect(pauseFor(10)).toBeNull();
    expect(pauseFor(null)).toBeNull();
  });

  it('stops at once when Instagram blocks the account, and ignores comments made during the pause', async () => {
    const send = stubFetch(() => failure(368));
    const { admin, conn, saved } = setup();
    await replyToComments(admin, conn, [rule()], people(5), NOW);
    expect(send).toHaveBeenCalledTimes(1);
    const until = new Date(NOW + 24 * 3600_000).toISOString();
    expect(saved).toMatchObject({ comments_paused_until: until, comments_ignore_before: until });
    const later = NOW + 25 * 3600_000;
    const fresh = connection({ comments_paused_until: until, comments_ignore_before: until });
    const during = comment({ commentId: 'd', commenterId: 'd', at: new Date(NOW + 3600_000).toISOString() });
    const after = comment({ commentId: 'a', commenterId: 'a', at: new Date(later - 60_000).toISOString() });
    stubFetch(ok);
    expect((await replyToComments(admin, fresh, [rule()], [during, after], later)).sent).toBe(1);
  });

  it('pauses after several failures in a row, but not when a success breaks the run', async () => {
    const send = stubFetch(() => failure(10));
    const a = setup();
    await replyToComments(a.admin, a.conn, [rule()], people(10), NOW);
    expect(send).toHaveBeenCalledTimes(FAILURES_BEFORE_PAUSE);
    expect(a.saved.comments_pause_reason).toContain('in a row');

    const b = setup({}, [{ id: 's', connection_id: 'c1', comment_id: 's', media_id: 's', commenter_key: 's', status: 'sent', created_at: '2026-11-24T10:00:00.000Z' }]);
    await replyToComments(b.admin, b.conn, [rule()], people(FAILURES_BEFORE_PAUSE - 1), NOW);
    expect(b.saved.comments_paused_until).toBeNull();
  });

  it('does nothing while paused, including reading comments', async () => {
    const send = stubFetch(ok);
    const until = new Date(NOW + 60_000).toISOString();
    const { admin, conn, tables } = setup({ comments_paused_until: until });
    tables.instagram_comment_rules.push({ ...rule(), connection_id: 'c1' });
    expect((await replyToComments(admin, conn, [rule()], [comment()], NOW)).sent).toBe(0);
    expect((await checkInstagramComments(admin, NOW)).connections).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('public replies', () => {
  const withPublic = (over: Partial<CommentRule> = {}) => rule({ public_replies: ['Sent you a DM', 'Check your DMs'], ...over });
  const isPublic = (url: string) => url.endsWith('/replies');
  const publicCalls = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([url]) => isPublic(String(url)));

  it('posts one of the variations after the DM is confirmed', async () => {
    const f = stubFetch((url) => (isPublic(url) ? new Response('{"id":"reply"}') : ok()));
    const { admin, conn, replies } = setup();
    await replyToComments(admin, conn, [withPublic()], [comment()], NOW);
    expect(f.mock.calls.map(([url]) => isPublic(String(url)))).toEqual([false, true]);
    expect(['Sent you a DM', 'Check your DMs']).toContain(JSON.parse(publicCalls(f)[0][1]!.body as string).message);
    expect(replies[0].public_status).toBe('sent');
  });

  it('posts nothing publicly when the DM fails or is unconfirmed', async () => {
    for (const handler of [() => failure(10), () => { throw new Error('timeout'); }]) {
      const f = stubFetch(handler);
      const { admin, conn } = setup();
      await replyToComments(admin, conn, [withPublic()], [comment()], NOW);
      expect(publicCalls(f)).toEqual([]);
    }
  });

  it('stops at the per-post limit while DMs continue', async () => {
    const f = stubFetch((url) => (isPublic(url) ? new Response('{"id":"reply"}') : ok()));
    const { admin, conn } = setup();
    expect((await replyToComments(admin, conn, [withPublic({ public_reply_limit: 2 })], people(5), NOW)).sent).toBe(5);
    expect(publicCalls(f)).toHaveLength(2);
  });

  it('pauses only public replies for a rate limit, and everything for a policy block', async () => {
    const f = stubFetch((url) => (isPublic(url) ? failure(613) : ok()));
    const a = setup();
    expect((await replyToComments(a.admin, a.conn, [withPublic()], people(3), NOW)).sent).toBe(3);
    expect(publicCalls(f)).toHaveLength(1);
    expect(a.saved).toMatchObject({ comments_paused_until: null, public_replies_paused_until: new Date(NOW + 3600_000).toISOString() });

    stubFetch((url) => (isPublic(url) ? failure(368) : ok()));
    const b = setup();
    expect((await replyToComments(b.admin, b.conn, [withPublic()], people(3), NOW)).sent).toBe(1);
    expect(b.saved.comments_paused_until).not.toBeNull();
  });
});

describe('rule input', () => {
  it('cleans valid rules and fills defaults', () => {
    expect(parseCommentRuleInput({ media_id: '', keywords: [' Price ', 'price', ''], reply_text: ' Hi ' })).toEqual({ value: { media_id: null, keywords: ['Price'], exclude_keywords: [], match_mode: 'word', skip_mentions: true, public_replies: [], public_reply_limit: 100, reply_text: 'Hi' } });
  });
  it('rejects bad rules', () => {
    const base = { keywords: [], reply_text: 'a' };
    for (const bad of [null, { ...base, keywords: 'x' }, { ...base, reply_text: ' ' }, { ...base, media_id: '../x' }, { ...base, keywords: ['x'.repeat(51)] }, { ...base, reply_text: '😊'.repeat(251) }, { ...base, exclude_keywords: [1] }, { ...base, match_mode: 'fuzzy' }, { ...base, skip_mentions: 'yes' }, { ...base, public_replies: ['x'.repeat(301)] }, { ...base, public_reply_limit: 0 }, { ...base, public_reply_limit: Number.NaN }]) expect(parseCommentRuleInput(bad)).toHaveProperty('error');
  });
});

describe('migration', () => {
  it('starts rules off, allows one reply per comment and per person per post, and keeps the log when a rule is deleted', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.accounts(id uuid PRIMARY KEY); CREATE FUNCTION public.is_account_member(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';`);
      for (const file of ['20261119173500_instagram_messaging', '20261120012205_instagram_disconnect', '20261124030000_instagram_comment_to_dm']) await db.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
      const [account, conn] = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
      await db.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
      await db.query("INSERT INTO instagram_connections(id,account_id,instagram_id,username,client_business_id,access_token) VALUES ($1,$2,'123','store','321','x')", [conn, account]);
      const { rows } = await db.query<Row>("INSERT INTO instagram_comment_rules(account_id,connection_id,reply_text) VALUES ($1,$2,'Hi') RETURNING *", [account, conn]);
      expect(rows[0]).toMatchObject({ active_since: null, match_mode: 'word', skip_mentions: true, exclude_keywords: [], public_replies: [], public_reply_limit: 100 });
      const add = (c: string, m: string, p: string) => db.query('INSERT INTO instagram_comment_replies(account_id,connection_id,rule_id,comment_id,media_id,commenter_key) VALUES ($1,$2,$3,$4,$5,$6)', [account, conn, rows[0].id, c, m, p]);
      await add('k1', 'm1', 'p1');
      await expect(add('k1', 'm2', 'p2')).rejects.toThrow();
      await expect(add('k2', 'm1', 'p1')).rejects.toThrow();
      await add('k3', 'm2', 'p1');
      await db.query('DELETE FROM instagram_comment_rules');
      expect((await db.query('SELECT count(*)::int AS n FROM instagram_comment_replies WHERE rule_id IS NULL')).rows).toEqual([{ n: 2 }]);
      const grants = await db.query("SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE (table_name LIKE 'instagram_comment%' AND grantee IN ('anon','authenticated') AND privilege_type <> 'SELECT') OR (table_name = 'instagram_connections' AND grantee IN ('anon','authenticated'))");
      expect(grants.rows).toEqual([{ n: 0 }]);
    } finally { await db.close(); }
  }, 20000);
});
