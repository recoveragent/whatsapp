import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isOriginAllowed, loadEnabledWidget, parseWidgetMessages, widgetClientIp, widgetCorsHeaders } from '@/lib/website-widget/config';

export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, { status: 204, headers: origin ? widgetCorsHeaders(origin) : {} });
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const ip = widgetClientIp(request);
  if (!checkRateLimit(`widget-config:${ip}`, RATE_LIMITS.widgetConfig).success ||
      !checkRateLimit(`widget-handoff:${ip}`, RATE_LIMITS.widgetVisitor).success) {
    return new Response(null, { status: 404 });
  }
  const db = supabaseAdmin();
  const widget = await loadEnabledWidget(db, new URL(request.url).searchParams.get('key'));
  if (!widget || !origin || !isOriginAllowed(origin, widget.allowed_domains) || !widget.whatsapp_number)
    return new Response(null, { status: 404 });
  const headers = widgetCorsHeaders(origin);
  const raw = await request.text();
  if (raw.length > 64 * 1024) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
  let body: { messages?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers }); }
  const messages = parseWidgetMessages(body?.messages);
  if (!messages) return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers });
  const token = randomBytes(16).toString('hex');
  const transcript = messages.map((m) => `${m.role === 'user' ? 'Visitor' : 'Assistant'}: ${m.content}`).join('\n\n').slice(0, 30000);
  // Opportunistic cleanup; the service role alone can read these records.
  await db.from('website_handoffs').delete().lt('expires_at', new Date().toISOString());
  const { error } = await db.from('website_handoffs').insert({ token, account_id: widget.account_id, transcript });
  if (error) return NextResponse.json({ error: 'Could not prepare handoff' }, { status: 503, headers });
  const text = `Hi, I need help with my website chat. Reference: WEB-${token}`;
  return NextResponse.json({ url: `https://wa.me/${widget.whatsapp_number}?text=${encodeURIComponent(text)}` }, { headers });
}
