import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const BOT = /bot|crawl|spider|preview|facebookexternalhit|facebot|meta-external|whatsapp|slurp/i;

async function follow(request: Request, context: { params: Promise<{ token: string }> }, isVisit: boolean) {
  const { token } = await context.params;
  const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
  if (!TOKEN.test(token)) return new NextResponse('Link not found.', { status: 404, headers });
  const count = isVisit && !BOT.test(request.headers.get('user-agent') ?? '');
  const { data, error } = await supabaseAdmin().rpc('instagram_comment_click', { p_token: token, p_count: count });
  if (error) return new NextResponse('Please try this link again.', { status: 503, headers });
  // Targets are only ever written by the server, but never redirect to anything else.
  if (typeof data !== 'string' || !data.startsWith('https://')) return new NextResponse('Link not found.', { status: 404, headers });
  const response = NextResponse.redirect(data, 302);
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

/** GET /l/[token] — public product link sent in Instagram cards. Counts visits from people. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  return follow(request, context, true);
}

/** Link checkers use HEAD; resolve without counting a visit. */
export async function HEAD(request: Request, context: { params: Promise<{ token: string }> }) {
  return follow(request, context, false);
}
