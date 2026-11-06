import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  buildWhatsAppUrl,
  isOriginAllowed,
  loadEnabledWidget,
  widgetClientIp,
  widgetCorsHeaders,
} from '@/lib/website-widget/config';

/** Preflight carries no key, so real checks happen on the request itself. */
export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: origin ? widgetCorsHeaders(origin) : {},
  });
}

/**
 * GET /api/widget/config?key=wgt_...  (public)
 *
 * What the embed script needs to draw itself. Every failure is the same 404,
 * so a stranger can't tell a wrong key from a disabled widget or wrong site.
 */
export async function GET(request: Request) {
  const notFound = NextResponse.json({ error: 'Not found' }, { status: 404 });

  const limit = checkRateLimit(
    `widget-config:${widgetClientIp(request)}`,
    RATE_LIMITS.widgetConfig
  );
  if (!limit.success) return notFound;

  const key = new URL(request.url).searchParams.get('key');
  const origin = request.headers.get('origin');
  const widget = await loadEnabledWidget(supabaseAdmin(), key);
  if (!widget || !origin || !isOriginAllowed(origin, widget.allowed_domains))
    return notFound;

  return NextResponse.json(
    {
      title: widget.title,
      greeting: widget.greeting,
      accent_color: widget.accent_color,
      whatsapp_url: buildWhatsAppUrl(widget.whatsapp_number),
    },
    { headers: widgetCorsHeaders(origin) }
  );
}
