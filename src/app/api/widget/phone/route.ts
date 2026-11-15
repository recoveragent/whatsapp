import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isOriginAllowed, loadEnabledWidget, widgetClientIp, widgetCorsHeaders } from '@/lib/website-widget/config';
import { findExistingContact } from '@/lib/contacts/dedupe';
import { ensureShopifyContact } from '@/lib/shopify/ensure-contact';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, { status: 204, headers: origin ? widgetCorsHeaders(origin) : {} });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const ip = widgetClientIp(request);
  if (!checkRateLimit(`widget-config:${ip}`, RATE_LIMITS.widgetConfig).success ||
      !checkRateLimit(`widget-phone:${ip}`, RATE_LIMITS.widgetVisitor).success)
    return new Response(null, { status: 404 });
  const db = supabaseAdmin();
  const widget = await loadEnabledWidget(db, new URL(request.url).searchParams.get('key'));
  if (!widget || !origin || !isOriginAllowed(origin, widget.allowed_domains))
    return new Response(null, { status: 404 });
  const headers = widgetCorsHeaders(origin);
  const raw = await request.text().catch(() => '');
  if (raw.length > 1024) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
  let body: { session_key?: unknown; country_code?: unknown; phone?: unknown } | null;
  try { body = JSON.parse(raw); } catch { body = null; }
  if (typeof body?.session_key !== 'string' || !/^[0-9a-f]{64}$/.test(body.session_key) ||
      typeof body.country_code !== 'string' || !/^\+[1-9][0-9]{0,2}$/.test(body.country_code) ||
      typeof body.phone !== 'string' || !/^[0-9]{10}$/.test(body.phone))
    return NextResponse.json({ error: 'Enter a valid country code and 10-digit mobile number.' }, { status: 400, headers });
  const hash = createHash('sha256').update(body.session_key).digest('hex');
  const { data: session, error } = await db.from('website_chat_sessions')
    .select('id').eq('account_id', widget.account_id).eq('session_hash', hash).maybeSingle();
  if (error || !session) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
  const { data: turns, error: turnsError } = await db.from('website_chat_messages')
    .select('role, content').eq('account_id', widget.account_id).eq('session_id', session.id)
    .order('created_at', { ascending: true }).limit(2);
  const name = turns?.[0]?.role === 'user' && turns?.[1]?.role === 'assistant' &&
    turns[1].content === `Nice to meet you, ${turns[0].content}! How can I help you today?`
    ? turns[0].content as string : null;
  if (turnsError) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
  const phone = body.country_code + body.phone;
  if (name) {
    const { data: account, error: accountError } = await db.from('accounts').select('owner_user_id').eq('id', widget.account_id).single();
    if (accountError || !account?.owner_user_id) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
    const existing = await findExistingContact(db, widget.account_id, phone);
    if (!existing && !await ensureShopifyContact(db, widget.account_id, account.owner_user_id, phone, name))
      return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
    if (existing && (!existing.name || normalizePhone(existing.name) === normalizePhone(existing.phone))) {
      const { error: nameError } = await db.from('contacts').update({ name, updated_at: new Date().toISOString() })
        .eq('account_id', widget.account_id).eq('id', existing.id);
      if (nameError) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
    }
  }
  const { error: updateError } = await db.from('website_chat_sessions').update({ phone })
    .eq('account_id', widget.account_id).eq('id', session.id);
  if (updateError) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
  return NextResponse.json({ saved: true }, { headers });
}
