import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveShopifyTrackingRedirect } from '@/lib/shopify/tracking-redirect';

/**
 * GET /t/[token]
 * Public redirect to a carrier tracking URL (multi-tenant via token lookup).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const targetUrl = await resolveShopifyTrackingRedirect(supabaseAdmin(), token);

  if (!targetUrl) {
    return new NextResponse('Tracking link not found or expired.', { status: 404 });
  }

  return NextResponse.redirect(targetUrl, 302);
}
