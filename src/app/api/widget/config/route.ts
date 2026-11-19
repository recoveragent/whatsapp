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
      launcher_greeting_enabled: widget.launcher_greeting_enabled,
      launcher_greeting_text: widget.launcher_greeting_text,
      launcher_greeting_delay: widget.launcher_greeting_delay,
      launcher_indicator: widget.launcher_indicator,
      avatar_url: widget.avatar_url,
      show_whatsapp_link: widget.show_whatsapp_link,
      suggested_questions: widget.suggested_questions,
      accent_color: widget.accent_color,
      desktop_side_offset: widget.desktop_side_offset,
      desktop_bottom_offset: widget.desktop_bottom_offset,
      mobile_side_offset: widget.mobile_side_offset,
      mobile_bottom_offset: widget.mobile_bottom_offset,
      desktop_position: widget.desktop_position,
      mobile_position: widget.mobile_position,
      whatsapp_url: buildWhatsAppUrl(widget.whatsapp_number),
    },
    { headers: widgetCorsHeaders(origin) }
  );
}
