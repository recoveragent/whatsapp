import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isOriginAllowed, loadEnabledWidget, widgetClientIp, widgetCorsHeaders } from '@/lib/website-widget/config';

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
  const { data, error } = await db.from('website_chat_sessions')
    .update({ phone: body.country_code + body.phone })
    .eq('account_id', widget.account_id).eq('session_hash', hash).select('id').maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Could not save your number. Please try again.' }, { status: 503, headers });
  return NextResponse.json({ saved: true }, { headers });
}
