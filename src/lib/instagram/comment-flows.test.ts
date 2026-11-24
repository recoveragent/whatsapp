import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProductCards, cardImage, formatPrice, productUrl } from './cards';
import { processCommentFlows } from './comment-flows';
import { replyToComments, type CommentConnection, type CommentRule, type InstagramComment } from './comments';
import { testAdmin, type Row } from './test-admin';

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }));
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.test'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const NOW = Date.parse('2026-11-24T10:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const connection: CommentConnection = { id: 'c1', account_id: 'a1', instagram_id: '123', username: 'store', access_token: 'token', comments_paused_until: null, comments_ignore_before: null, public_replies_paused_until: null };
const product = (id: number, over: Row = {}): Row => ({ id: `p${id}`, account_id: 'a1', status: 'active', shopify_product_id: id, shopify_variant_id: id * 10, title: `Frame ${id}`, price: '799.00', currency: 'INR', image_url: 'https://cdn.shopify.com/f.webp?v=1', inventory_quantity: null, handle: `frame-${id}`, ...over });
const baseTables = (): Record<string, Row[]> => ({
  instagram_connections: [{ ...connection }], instagram_comment_replies: [], instagram_threads: [{ id: 't1', connection_id: 'c1', participant_id: '456', participant_username: 'alice' }], instagram_messages: [], instagram_comment_links: [],
  shopify_config: [{ account_id: 'a1', shop_domain: 'shop.myshopify.com' }], shopify_products: [product(1), product(2)],
});
const ok = () => new Response(JSON.stringify({ recipient_id: '456', message_id: 'mid' }));
const failure = (code: number) => new Response(JSON.stringify({ error: { message: 'Not allowed', code } }), { status: 400 });
const stubFetch = (handler: (n: number) => Response) => { let n = 0; const f = vi.fn<typeof fetch>(async () => handler(n++)); vi.stubGlobal('fetch', f); return f; };
const bodyOf = (f: ReturnType<typeof stubFetch>, n: number) => JSON.parse(f.mock.calls[n][1]!.body as string);

describe('cards', () => {
  it('formats prices, images and links', () => {
    expect(formatPrice('1199.00', 'INR').replace(/\s/g, '')).toBe('₹1,199');
    expect(formatPrice('abc', 'INR')).toBe('');
    expect(cardImage('https://cdn.shopify.com/f.webp?v=1')).toBe('https://cdn.shopify.com/f.webp?v=1&width=1080&format=jpg');
    expect(cardImage('javascript:alert(1)')).toBeUndefined();
    expect(cardImage(null)).toBeUndefined();
    expect(productUrl('shop.myshopify.com', { handle: 'a b', shopify_variant_id: 7 })).toBe('https://shop.myshopify.com/products/a%20b?variant=7&utm_source=instagram&utm_medium=comment_to_dm');
    expect(productUrl('s', { handle: null, shopify_variant_id: 7 })).toBeNull();
  });
  it('keeps the chosen order, drops sold-out products, and stores a tracked link for each', async () => {
    const tables = baseTables();
    tables.shopify_products.push(product(3, { inventory_quantity: 0 }), product(4, { account_id: 'other' }));
    const { admin } = testAdmin(tables);
    const cards = await buildProductCards(admin, 'a1', [2, 3, 4, 1], 'r1');
    expect(cards.map((c) => c.title)).toEqual(['Frame 2', 'Frame 1']);
    expect(tables.instagram_comment_links).toHaveLength(2);
    const link = tables.instagram_comment_links[0];
    expect(link).toMatchObject({ account_id: 'a1', reply_id: 'r1' });
    expect(cards[0].buttons[0]).toMatchObject({ type: 'web_url', url: `https://app.test/l/${link.token}` });
    expect(link.url).toContain('https://shop.myshopify.com/products/frame-2?variant=20');
  });
});

const rule = (over: Partial<CommentRule> = {}): CommentRule => ({ id: 'r1', media_id: null, keywords: [], exclude_keywords: [], match_mode: 'word', skip_mentions: true, public_replies: [], public_reply_limit: 100, reply_text: 'Plain text', delivery: 'tap', product_ids: [1, 2], tap_title: 'Thanks!', tap_subtitle: 'Tap below', tap_button: 'View products', reminder_text: 'Still there?', reminder_minutes: 600, active_since: ago(60), created_at: ago(90), ...over });
const comment: InstagramComment = { commentId: 'k1', mediaId: 'm1', commenterId: '456', username: 'alice', text: 'price', at: ago(1), isReply: false };

describe('first message', () => {
  it('sends a tap card and copies what the follow-up needs', async () => {
    const f = stubFetch(ok);
    const { admin, tables, calls } = testAdmin(baseTables());
    await replyToComments(admin, { ...connection }, [rule()], [comment], NOW);
    const element = bodyOf(f, 0).message.attachment.payload.elements[0];
    expect(bodyOf(f, 0).recipient).toEqual({ comment_id: 'k1' });
    expect(element).toMatchObject({ title: 'Thanks!', subtitle: 'Tap below', buttons: [{ type: 'postback', title: 'View products' }] });
    expect(tables.instagram_comment_replies[0]).toMatchObject({ status: 'sent', delivery: 'tap', recipient_id: '456', tap_label: 'View products', product_ids: [1, 2], fallback_text: 'Plain text', reminder_text: 'Still there?' });
    expect(calls[0]).toMatchObject({ p_content: '[Attachment]' });
  });
  it('sends product cards straight away', async () => {
    const f = stubFetch(ok);
    const { admin, tables } = testAdmin(baseTables());
    await replyToComments(admin, { ...connection }, [rule({ delivery: 'products' })], [comment], NOW);
    expect(bodyOf(f, 0).message.attachment.payload.elements).toHaveLength(2);
    expect(tables.instagram_comment_replies[0]).toMatchObject({ delivery: 'products', status: 'sent' });
  });
  it('falls back to text only when Meta refuses the card itself', async () => {
    const refused = stubFetch((n) => (n === 0 ? failure(100) : ok()));
    const a = testAdmin(baseTables());
    await replyToComments(a.admin, { ...connection }, [rule()], [comment], NOW);
    expect(bodyOf(refused, 1).message).toEqual({ text: 'Plain text' });
    expect(a.tables.instagram_comment_replies[0]).toMatchObject({ delivery: 'text', status: 'sent' });
    expect(a.tables.instagram_comment_replies[0].tap_label).toBeUndefined();

    for (const handler of [() => failure(10), () => failure(368), () => { throw new Error('timeout'); }]) {
      const f = stubFetch(handler);
      const b = testAdmin(baseTables());
      await replyToComments(b.admin, { ...connection }, [rule()], [comment], NOW);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it('sends text when no product can be shown, and leaves text rules unchanged', async () => {
    for (const over of [{ product_ids: [99] }, { delivery: 'text' as const }, { delivery: 'products' as const, product_ids: [99] }]) {
      const f = stubFetch(ok);
      const { admin } = testAdmin(baseTables());
      await replyToComments(admin, { ...connection }, [rule(over)], [comment], NOW);
      expect(bodyOf(f, 0).message).toEqual({ text: 'Plain text' });
    }
  });
});

const reply = (over: Row = {}): Row => ({ id: 'r1', account_id: 'a1', connection_id: 'c1', recipient_id: '456', delivery: 'tap', status: 'sent', created_at: ago(30), product_ids: [1, 2], fallback_text: 'Plain text', tap_label: 'View products', tapped_at: null, tap_message_id: null, products_status: null, products_sent_at: null, reminder_text: null, reminder_minutes: 600, reminder_status: null, ...over });
const inbound = (id: string, minutes: number, content = 'View products'): Row => ({ id, thread_id: 't1', direction: 'inbound', content, created_at: ago(minutes) });
function flowSetup(replies: Row[], messages: Row[]) {
  const tables = baseTables();
  tables.instagram_comment_replies = replies;
  tables.instagram_messages = messages;
  return testAdmin(tables);
}

describe('taps and products', () => {
  it('sends the products once after a tap', async () => {
    const f = stubFetch(ok);
    const { admin, tables } = flowSetup([reply()], [inbound('m1', 2)]);
    expect(await processCommentFlows(admin, NOW)).toMatchObject({ taps: 1, products: 1 });
    expect(await processCommentFlows(admin, NOW + 60_000)).toMatchObject({ taps: 0, products: 0 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(bodyOf(f, 0).recipient).toEqual({ id: '456' });
    expect(tables.instagram_comment_replies[0]).toMatchObject({ tap_message_id: 'm1', products_status: 'sent' });
  });
  it('ignores other messages, earlier messages and other customers', async () => {
    const f = stubFetch(ok);
    const { admin } = flowSetup([reply()], [inbound('m1', 2, 'hello'), inbound('m2', 45), { ...inbound('m3', 2), thread_id: 't2' }, { ...inbound('m4', 2), direction: 'outbound' }]);
    expect((await processCommentFlows(admin, NOW)).taps).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
  it('answers one card per tap, the newest one first', async () => {
    stubFetch(ok);
    const { admin, tables } = flowSetup([reply({ id: 'old', created_at: ago(60) }), reply({ id: 'new', created_at: ago(20) })], [inbound('m1', 2)]);
    expect((await processCommentFlows(admin, NOW)).products).toBe(1);
    expect((await processCommentFlows(admin, NOW + 60_000)).products).toBe(0);
    expect(tables.instagram_comment_replies.find((r) => r.id === 'new')!.tap_message_id).toBe('m1');
    expect(tables.instagram_comment_replies.find((r) => r.id === 'old')!.tapped_at).toBeNull();
  });
  it('sends once when two runs overlap', async () => {
    const f = stubFetch(ok);
    const { admin } = flowSetup([reply({ tapped_at: ago(2), tap_message_id: 'm1' })], []);
    await Promise.all([processCommentFlows(admin, NOW), processCommentFlows(admin, NOW)]);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('uses the text when products sold out, and never sends after the window', async () => {
    const f = stubFetch(ok);
    const a = flowSetup([reply({ tapped_at: ago(2), product_ids: [99] })], []);
    await processCommentFlows(a.admin, NOW);
    expect(bodyOf(f, 0).message).toEqual({ text: 'Plain text' });
    const late = stubFetch(ok);
    const b = flowSetup([reply({ tapped_at: ago(24 * 60) })], []);
    await processCommentFlows(b.admin, NOW);
    expect(late).not.toHaveBeenCalled();
  });
  it('waits while paused or disconnected, records refusals once, and pauses on a policy block', async () => {
    const f = stubFetch(() => failure(368));
    const a = flowSetup([reply({ tapped_at: ago(2) })], []);
    await processCommentFlows(a.admin, NOW);
    await processCommentFlows(a.admin, NOW);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.tables.instagram_comment_replies[0]).toMatchObject({ products_status: 'failed', products_error: 'Not allowed (368)' });
    expect(a.tables.instagram_connections[0].comments_paused_until).not.toBeNull();
    for (const over of [{ comments_paused_until: new Date(NOW + 60_000).toISOString() }, { access_token: null }]) {
      const quiet = stubFetch(ok);
      const b = flowSetup([reply({ tapped_at: ago(2) })], []);
      Object.assign(b.tables.instagram_connections[0], over);
      await processCommentFlows(b.admin, NOW);
      expect(quiet).not.toHaveBeenCalled();
      expect(b.tables.instagram_comment_replies[0].products_status).toBeNull();
    }
  });
});

describe('reminders', () => {
  const done = (over: Row = {}) => reply({ tapped_at: ago(601), tap_message_id: 'm1', products_status: 'sent', products_sent_at: ago(600), reminder_text: 'Still there?', ...over });
  it('sends one reminder when due', async () => {
    const f = stubFetch(ok);
    const { admin, tables } = flowSetup([done()], [inbound('m1', 601), { ...inbound('own', 600, '[Attachment]'), direction: 'outbound' }]);
    expect((await processCommentFlows(admin, NOW)).reminders).toBe(1);
    expect((await processCommentFlows(admin, NOW + 60_000)).reminders).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);
    expect(bodyOf(f, 0)).toEqual({ recipient: { id: '456' }, message: { text: 'Still there?' } });
    expect(tables.instagram_comment_replies[0].reminder_status).toBe('sent');
  });
  it('is not sent early, without products, or without a reminder', async () => {
    const f = stubFetch(ok);
    for (const over of [{ tapped_at: ago(599) }, { products_status: 'failed' }, { products_status: 'unknown' }, { reminder_text: null }]) await processCommentFlows(flowSetup([done(over)], []).admin, NOW);
    expect(f).not.toHaveBeenCalled();
  });
  it('is skipped when the customer or team wrote, or the window closed', async () => {
    const f = stubFetch(ok);
    const cases: [Row, Row[], string][] = [
      [done(), [inbound('x', 300, 'How long is delivery?')], 'customer'],
      [done(), [{ ...inbound('x', 300, 'Hi, can I help?'), direction: 'outbound' }], 'team'],
      [done({ tapped_at: ago(24 * 60), products_sent_at: ago(24 * 60 - 1) }), [], 'window'],
    ];
    for (const [row, messages, why] of cases) {
      const { admin, tables } = flowSetup([row], messages);
      await processCommentFlows(admin, NOW);
      expect(tables.instagram_comment_replies[0].reminder_status).toBe('skipped');
      expect(tables.instagram_comment_replies[0].reminder_error).toContain(why);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('still goes out when the customer only tapped again', async () => {
    stubFetch(ok);
    const { admin } = flowSetup([done()], [inbound('again', 500)]);
    expect((await processCommentFlows(admin, NOW)).reminders).toBe(1);
  });
});

describe('migration', () => {
  it('keeps existing rules as text, counts clicks, and reports stats', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.accounts(id uuid PRIMARY KEY); CREATE FUNCTION public.is_account_member(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';`);
      const run = (file: string) => db.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
      for (const file of ['20261119173500_instagram_messaging', '20261120012205_instagram_disconnect', '20261124061642_instagram_comment_to_dm']) await run(file);
      const [account, conn] = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
      await db.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
      await db.query("INSERT INTO instagram_connections(id,account_id,instagram_id,username,client_business_id,access_token) VALUES ($1,$2,'123','store','321','x')", [conn, account]);
      await db.query("INSERT INTO instagram_comment_rules(account_id,connection_id,reply_text) VALUES ($1,$2,'Hi')", [account, conn]);
      await run('20261124174202_instagram_comment_cards');
      const { rows } = await db.query<Row>('SELECT * FROM instagram_comment_rules');
      expect(rows[0]).toMatchObject({ delivery: 'text', product_ids: [], reminder_text: null, reminder_minutes: 600 });
      const ins = await db.query<Row>("INSERT INTO instagram_comment_replies(account_id,connection_id,rule_id,comment_id,media_id,commenter_key,status,delivery,tapped_at) VALUES ($1,$2,$3,'k','m','p','sent','tap',now()) RETURNING id", [account, conn, rows[0].id]);
      await db.query("INSERT INTO instagram_comment_links(token,account_id,reply_id,url) VALUES ('tok',$1,$2,'https://x.test/p')", [account, ins.rows[0].id]);
      const click = async (token: string, count: boolean) => (await db.query<Row>('SELECT instagram_comment_click($1,$2) AS url', [token, count])).rows[0].url;
      expect(await click('tok', false)).toBe('https://x.test/p');
      expect(await click('tok', true)).toBe('https://x.test/p');
      expect(await click('missing', true)).toBeNull();
      expect((await db.query('SELECT clicks FROM instagram_comment_links')).rows).toEqual([{ clicks: 1 }]);
      expect((await db.query<Row>('SELECT sent::int,tapped::int,clicked::int,reminded::int FROM instagram_comment_stats($1)', [account])).rows).toEqual([{ sent: 1, tapped: 1, clicked: 1, reminded: 0 }]);
      const exposed = await db.query("SELECT has_function_privilege('authenticated','instagram_comment_click(text,boolean)','EXECUTE') AS c, has_function_privilege('anon','instagram_comment_stats(uuid)','EXECUTE') AS s, has_table_privilege('authenticated','instagram_comment_links','SELECT') AS t");
      expect(exposed.rows).toEqual([{ c: false, s: false, t: false }]);
    } finally { await db.close(); }
  }, 20000);
});
