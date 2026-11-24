import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommentRuleInput } from './comment-rule-input';
import { commentsFromGraph, matchesKeywords, MAX_REPLIES_PER_RUN, parseCommentEvents, pickRule, replyToComments, type CommentRule, type InstagramComment } from './comments';

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
afterEach(() => vi.unstubAllGlobals());

const NOW = Date.parse('2026-11-24T10:00:00Z');
const business = { instagram_id: '123', username: 'store' };
const connection = { id: 'c1', account_id: 'a1', access_token: 'token', ...business };
const rule = (over: Partial<CommentRule> = {}): CommentRule => ({ id: 'r1', media_id: null, keywords: ['price'], reply_text: 'Here you go', active_since: '2026-11-24T09:00:00Z', created_at: '2026-11-24T08:00:00Z', ...over });
const comment = (over: Partial<InstagramComment> = {}): InstagramComment => ({ commentId: 'k1', mediaId: 'm1', commenterId: '456', username: 'alice', text: 'Price please', at: '2026-11-24T09:30:00Z', isReply: false, ...over });

describe('keyword matching', () => {
  it('matches whole words in any case, phrases and other scripts', () => {
    expect(matchesKeywords('What is the PRICE?', ['price'])).toBe(true);
    expect(matchesKeywords('priceless', ['price'])).toBe(false);
    expect(matchesKeywords('send   me the link', ['send me'])).toBe(true);
    expect(matchesKeywords('कीमत क्या है', ['कीमत'])).toBe(true);
    expect(matchesKeywords('c++ rocks', ['c++'])).toBe(true);
    expect(matchesKeywords('anything', [])).toBe(true);
    expect(matchesKeywords('anything', ['  '])).toBe(false);
  });
});

describe('rule selection', () => {
  it('prefers a rule for the specific post', () => {
    expect(pickRule([rule(), rule({ id: 'r2', media_id: 'm1', created_at: '2026-11-24T08:30:00Z' })], comment(), business, NOW)?.id).toBe('r2');
  });
  it('never answers earlier, expired, own or nested comments, or while off', () => {
    const none = (c: Partial<InstagramComment>, r: Partial<CommentRule> = {}) => expect(pickRule([rule(r)], comment(c), business, NOW)).toBeNull();
    none({ at: '2026-11-24T08:59:59Z' });
    none({ at: '2026-11-17T09:00:00Z' }, { active_since: '2026-11-01T00:00:00Z' });
    none({ commenterId: '123' });
    none({ commenterId: null, username: 'store' });
    none({ isReply: true });
    none({}, { active_since: null });
    none({}, { media_id: 'other' });
    none({ at: 'invalid' });
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

type Row = Record<string, unknown>;
/** In-memory admin client enforcing the two uniqueness rules from the migration. */
function fakeAdmin() {
  const replies: Row[] = [];
  const recorded: Row[] = [];
  const admin = {
    from: (table: string) => ({
      insert: (row: Row) => ({ select: () => ({ single: async () => {
        if (replies.some((r) => r.comment_id === row.comment_id || (r.media_id === row.media_id && r.commenter_key === row.commenter_key))) return { data: null, error: { code: '23505' } };
        const saved = { id: `id${replies.length}`, status: 'sending', ...row };
        replies.push(saved);
        return { data: { id: saved.id }, error: null };
      } }) }),
      select: () => ({ eq: () => ({ in: async (_k: string, ids: string[]) => ({ data: replies.filter((r) => ids.includes(r.comment_id as string)), error: null }) }) }),
      update: (values: Row) => ({ eq: (k: string, v: unknown) => {
        if (table === 'instagram_comment_replies') { Object.assign(replies.find((r) => r[k] === v)!, values); return Promise.resolve({ error: null }); }
        return { eq: () => ({ is: async () => ({ error: null }) }) };
      } }),
    }),
    rpc: async (_name: string, args: Row) => { recorded.push(args); return { error: null }; },
  } as unknown as SupabaseClient;
  return { admin, replies, recorded };
}
const ok = () => new Response(JSON.stringify({ recipient_id: '456', message_id: 'mid' }));

describe('sending', () => {
  it('sends one DM by comment ID, records it, and never repeats it', async () => {
    const send = vi.fn<typeof fetch>(async () => ok());
    vi.stubGlobal('fetch', send);
    const { admin, replies, recorded } = fakeAdmin();
    expect((await replyToComments(admin, connection, [rule()], [comment()], NOW)).sent).toBe(1);
    expect((await replyToComments(admin, connection, [rule()], [comment(), comment({ commentId: 'k2' })], NOW)).sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ recipient: { comment_id: 'k1' }, message: { text: 'Here you go' } });
    expect(replies[0].status).toBe('sent');
    expect(recorded[0]).toMatchObject({ p_participant: '456', p_meta_id: 'mid', p_direction: 'outbound' });
  });

  it('sends once when webhook and minute check run together', async () => {
    const send = vi.fn(async () => ok());
    vi.stubGlobal('fetch', send);
    const { admin } = fakeAdmin();
    await Promise.all([replyToComments(admin, connection, [rule()], [comment()], NOW), replyToComments(admin, connection, [rule()], [comment()], NOW)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('saves the reason Meta gives and does not retry', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Not allowed', code: 10, error_subcode: 2534 } }), { status: 400 }));
    vi.stubGlobal('fetch', send);
    const { admin, replies, recorded } = fakeAdmin();
    await replyToComments(admin, connection, [rule()], [comment()], NOW);
    await replyToComments(admin, connection, [rule()], [comment()], NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replies[0]).toMatchObject({ status: 'failed', error: 'Not allowed (10/2534)' });
    expect(recorded).toEqual([]);
  });

  it('marks a lost response as unconfirmed and never resends it', async () => {
    const send = vi.fn(async () => { throw new Error('timeout'); });
    vi.stubGlobal('fetch', send);
    const { admin, replies } = fakeAdmin();
    await replyToComments(admin, connection, [rule()], [comment()], NOW);
    await replyToComments(admin, connection, [rule()], [comment()], NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(replies[0].status).toBe('unknown');
  });

  it('limits each run and continues with the rest next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    const { admin } = fakeAdmin();
    const many = Array.from({ length: MAX_REPLIES_PER_RUN + 5 }, (_, i) => comment({ commentId: `k${i}`, commenterId: `p${i}` }));
    expect((await replyToComments(admin, connection, [rule()], many, NOW)).sent).toBe(MAX_REPLIES_PER_RUN);
    expect((await replyToComments(admin, connection, [rule()], many, NOW)).sent).toBe(5);
  });
});

describe('rule input', () => {
  it('cleans valid rules and rejects bad ones', () => {
    expect(parseCommentRuleInput({ media_id: '', keywords: [' Price ', 'price', ''], reply_text: ' Hi ' })).toEqual({ value: { media_id: null, keywords: ['price'], reply_text: 'Hi' } });
    for (const bad of [null, { keywords: 'x', reply_text: 'a' }, { keywords: [], reply_text: ' ' }, { keywords: [], reply_text: 'a', media_id: '../x' }, { keywords: ['x'.repeat(51)], reply_text: 'a' }, { keywords: [], reply_text: '😊'.repeat(251) }]) expect(parseCommentRuleInput(bad)).toHaveProperty('error');
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
      const { rows } = await db.query<{ id: string; active_since: string | null }>("INSERT INTO instagram_comment_rules(account_id,connection_id,reply_text) VALUES ($1,$2,'Hi') RETURNING id,active_since", [account, conn]);
      expect(rows[0].active_since).toBeNull();
      const add = (c: string, m: string, p: string) => db.query('INSERT INTO instagram_comment_replies(account_id,connection_id,rule_id,comment_id,media_id,commenter_key) VALUES ($1,$2,$3,$4,$5,$6)', [account, conn, rows[0].id, c, m, p]);
      await add('k1', 'm1', 'p1');
      await expect(add('k1', 'm2', 'p2')).rejects.toThrow();
      await expect(add('k2', 'm1', 'p1')).rejects.toThrow();
      await add('k3', 'm2', 'p1');
      await db.query('DELETE FROM instagram_comment_rules');
      expect((await db.query('SELECT count(*)::int AS n FROM instagram_comment_replies WHERE rule_id IS NULL')).rows).toEqual([{ n: 2 }]);
      const grants = await db.query("SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_name LIKE 'instagram_comment%' AND grantee IN ('anon','authenticated') AND privilege_type <> 'SELECT'");
      expect(grants.rows).toEqual([{ n: 0 }]);
    } finally { await db.close(); }
  }, 20000);
});
