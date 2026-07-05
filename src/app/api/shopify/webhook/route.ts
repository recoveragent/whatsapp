import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { handleShopifyWebhook } from '@/lib/shopify/handle-webhook';
import { verifyShopifyWebhookHmac } from '@/lib/shopify/webhook-verify';

/**
 * POST /api/shopify/webhook
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const topic = request.headers.get('x-shopify-topic');
  const shopDomain = request.headers.get('x-shopify-shop-domain');

  if (!topic || !shopDomain) {
    return NextResponse.json({ error: 'Missing Shopify headers' }, { status: 400 });
  }

  try {
    if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Webhook verification not configured' }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const orderRef =
    topic.startsWith('orders/') && payload && typeof payload === 'object'
      ? ((payload as { name?: string; id?: string | number }).name ??
        (payload as { id?: string | number }).id ??
        null)
      : null;

  console.info('[shopify webhook] received', {
    topic,
    shop: shopDomain,
    order: orderRef,
  });

  try {
    await handleShopifyWebhook({
      db: supabaseAdmin(),
      shopDomain,
      topic,
      payload,
    });
  } catch (err) {
    console.error('[shopify webhook]', topic, err);
  }

  return NextResponse.json({ ok: true });
}
