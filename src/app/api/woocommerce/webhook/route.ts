import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { handleWooCommerceWebhook } from '@/lib/woocommerce/handle-webhook';
import { verifyWooCommerceWebhookSignature } from '@/lib/woocommerce/webhook-verify';

/**
 * POST /api/woocommerce/webhook
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-wc-webhook-signature');
  const topic = request.headers.get('x-wc-webhook-topic');
  const storeUrl = request.headers.get('x-wc-webhook-source');

  if (!topic || !storeUrl) {
    return NextResponse.json({ error: 'Missing WooCommerce headers' }, { status: 400 });
  }

  try {
    if (!(await verifyWooCommerceWebhookSignature(rawBody, signature, storeUrl))) {
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
    topic.startsWith('order.') && payload && typeof payload === 'object'
      ? ((payload as { number?: string | number }).number ??
        (payload as { id?: string | number }).id ??
        null)
      : null;

  console.info('[woocommerce webhook] received', {
    topic,
    store: storeUrl,
    order: orderRef,
  });

  try {
    await handleWooCommerceWebhook({
      db: supabaseAdmin(),
      storeUrl,
      topic,
      payload,
    });
  } catch (err) {
    console.error('[woocommerce webhook]', topic, err);
  }

  return NextResponse.json({ ok: true });
}
