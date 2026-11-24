import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { graphError } from '@/lib/instagram/comments';
import { parseCommentRuleInput } from '@/lib/instagram/comment-rule-input';
import { decrypt } from '@/lib/whatsapp/encryption';

const UUID = /^[0-9a-f-]{36}$/i;
const FIELDS = 'id,connection_id,media_id,keywords,reply_text,active_since,last_checked_at,last_error,created_at';
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
      const url = `https://graph.facebook.com/v27.0/${encodeURIComponent(connection.instagram_id)}/media?fields=id,caption,media_type,timestamp&limit=25`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${decrypt(connection.access_token)}` }, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data)) return bad(`Could not load posts: ${graphError(body?.error ?? {})}`, 502);
      return NextResponse.json({ media: body.data });
    }
    const ctx = await getCurrentAccount();
    const [rules, replies] = await Promise.all([
      ctx.supabase.from('instagram_comment_rules').select(FIELDS).eq('account_id', ctx.accountId).order('created_at'),
      ctx.supabase.from('instagram_comment_replies').select('id,rule_id,commenter_username,status,error,created_at').eq('account_id', ctx.accountId).order('created_at', { ascending: false }).limit(20),
    ]);
    if (rules.error) throw rules.error;
    if (replies.error) throw replies.error;
    return NextResponse.json({ rules: rules.data, replies: replies.data });
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

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
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
