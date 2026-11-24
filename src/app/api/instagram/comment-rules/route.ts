import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { graphError } from '@/lib/instagram/comments';
import { parseCommentRuleInput } from '@/lib/instagram/comment-rule-input';
import { cardImage, formatPrice } from '@/lib/instagram/cards';
import { getShopifyCatalogProductsForProductIds, searchShopifyProducts, type ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import { decrypt } from '@/lib/whatsapp/encryption';

const UUID = /^[0-9a-f-]{36}$/i;
const FIELDS = 'id,connection_id,media_id,keywords,exclude_keywords,match_mode,skip_mentions,public_replies,public_reply_limit,reply_text,delivery,product_ids,tap_title,tap_subtitle,tap_button,reminder_text,reminder_minutes,active_since,last_checked_at,last_error,created_at';
const summary = (p: ShopifyCatalogProduct) => ({ id: p.shopify_product_id, title: p.title, image: cardImage(p.image_url) ?? null, price: formatPrice(p.price, p.currency) || null });
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(request: Request) {
  try {
    const mediaFor = new URL(request.url).searchParams.get('media');
    if (mediaFor !== null) {
      const ctx = await requireRole('admin');
      if (!UUID.test(mediaFor)) return bad('Invalid connection');
      const { data: connection, error } = await supabaseAdmin().from('instagram_connections').select('instagram_id,access_token').eq('account_id', ctx.accountId).eq('id', mediaFor).not('access_token', 'is', null).maybeSingle();
      if (error) throw error;
      if (!connection) return bad('Instagram is disconnected.', 404);
      const url = `https://graph.facebook.com/v27.0/${encodeURIComponent(connection.instagram_id)}/media?fields=id,caption,media_type,timestamp,media_url,thumbnail_url,permalink&limit=25`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${decrypt(connection.access_token)}` }, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data)) return bad(`Could not load posts: ${graphError(body?.error ?? {})}`, 502);
      return NextResponse.json({ media: body.data });
    }
    const search = new URL(request.url).searchParams.get('products');
    if (search !== null) {
      const ctx = await requireRole('admin');
      const found = await searchShopifyProducts({ db: supabaseAdmin(), accountId: ctx.accountId, query: search.slice(0, 80), limit: 50 });
      // The catalogue has one row per variant; the picker needs one per product.
      const products = [...new Map(found.filter((p) => p.handle).map((p) => [p.shopify_product_id, summary(p)])).values()].slice(0, 15);
      return NextResponse.json({ products });
    }
    const ctx = await getCurrentAccount();
    const [rules, replies, pauses, stats] = await Promise.all([
      ctx.supabase.from('instagram_comment_rules').select(FIELDS).eq('account_id', ctx.accountId).order('created_at'),
      ctx.supabase.from('instagram_comment_replies').select('id,rule_id,commenter_username,status,error,public_status,public_error,delivery,tapped_at,products_status,products_error,reminder_status,reminder_error,created_at').eq('account_id', ctx.accountId).order('created_at', { ascending: false }).limit(20),
      supabaseAdmin().from('instagram_connections').select('id,comments_paused_until,comments_pause_reason,public_replies_paused_until').eq('account_id', ctx.accountId).not('access_token', 'is', null),
      supabaseAdmin().rpc('instagram_comment_stats', { p_account: ctx.accountId }),
    ]);
    if (rules.error) throw rules.error;
    if (replies.error) throw replies.error;
    if (pauses.error) throw pauses.error;
    if (stats.error) throw stats.error;
    const ids = [...new Set((rules.data ?? []).flatMap((r) => r.product_ids as number[]))];
    const products = (await getShopifyCatalogProductsForProductIds({ db: supabaseAdmin(), accountId: ctx.accountId, productIds: ids })).map(summary);
    return NextResponse.json({ rules: rules.data, replies: replies.data, pauses: pauses.data, stats: stats.data, products });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    const parsed = parseCommentRuleInput(body);
    if ('error' in parsed) return bad(parsed.error);
    if (typeof body.connection_id !== 'string' || !UUID.test(body.connection_id)) return bad('Connect Instagram first.');
    const admin = supabaseAdmin();
    const { data: connection, error: connectionError } = await admin.from('instagram_connections').select('id').eq('account_id', ctx.accountId).eq('id', body.connection_id).not('access_token', 'is', null).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return bad('Connect Instagram first.');
    // New rules are always off until someone switches them on.
    const { data, error } = await admin.from('instagram_comment_rules').insert({ ...parsed.value, account_id: ctx.accountId, connection_id: connection.id }).select(FIELDS).single();
    if (error) throw error;
    return NextResponse.json({ rule: data });
  } catch (error) { return toErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return bad('Invalid rule');
    const parsed = parseCommentRuleInput(body);
    if ('error' in parsed) return bad(parsed.error);
    const admin = supabaseAdmin();
    const { data: current, error: currentError } = await admin.from('instagram_comment_rules').select('active_since').eq('account_id', ctx.accountId).eq('id', body.id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return bad('Rule not found', 404);
    // Editing a rule that is on restarts its clock, so wider keywords never reach earlier comments.
    const update = admin.from('instagram_comment_rules').update({ ...parsed.value, active_since: current.active_since ? new Date().toISOString() : null, last_error: null }).eq('account_id', ctx.accountId).eq('id', body.id);
    const { data, error } = await (current.active_since ? update.not('active_since', 'is', null) : update.is('active_since', null)).select(FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) return bad('This rule was just switched on or off. Reload and try again.', 409);
    return NextResponse.json({ rule: data });
  } catch (error) { return toErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    if (body.resume_connection_id !== undefined) {
      if (typeof body.resume_connection_id !== 'string' || !UUID.test(body.resume_connection_id)) return bad('Invalid connection');
      // Comments made during the pause stay unanswered.
      const { data, error } = await supabaseAdmin().from('instagram_connections').update({ comments_paused_until: null, comments_pause_reason: null, public_replies_paused_until: null, comments_ignore_before: new Date().toISOString() }).eq('account_id', ctx.accountId).eq('id', body.resume_connection_id).not('access_token', 'is', null).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return bad('Instagram is disconnected.', 404);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return bad('Invalid rule');
    if (typeof body.active !== 'boolean') return bad('Invalid rule state');
    // Turning a rule on restarts its clock, so earlier comments are never messaged.
    const { data, error } = await supabaseAdmin().from('instagram_comment_rules').update({ active_since: body.active ? new Date().toISOString() : null, last_error: null }).eq('account_id', ctx.accountId).eq('id', body.id).select(FIELDS).maybeSingle();
    if (error) throw error;
    if (!data) return bad('Rule not found', 404);
    return NextResponse.json({ rule: data });
  } catch (error) { return toErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await request.json();
    if (typeof id !== 'string' || !UUID.test(id)) return bad('Invalid rule');
    const { data, error } = await supabaseAdmin().from('instagram_comment_rules').delete().eq('account_id', ctx.accountId).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return bad('Rule not found', 404);
    return NextResponse.json({ ok: true });
  } catch (error) { return toErrorResponse(error); }
}
