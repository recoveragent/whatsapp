import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { parseInstagramEvents } from '@/lib/instagram/webhook';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (!token || params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== token || !params.has('hub.challenge')) {
    return new Response('Forbidden', { status: 403 });
  }
  return new Response(params.get('hub.challenge'), { status: 200 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) { console.warn('[instagram webhook] signature rejected'); return new Response('Unauthorized', { status: 401 }); }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { console.warn('[instagram webhook] invalid JSON'); return new Response('Bad request', { status: 400 }); }
  const admin = supabaseAdmin();
  const events = parseInstagramEvents(payload);
  console.info('[instagram webhook] received', JSON.stringify({ instagram: (payload as { object?: unknown })?.object === 'instagram', events: events.length }));
  for (const event of events) {
    const { data: connection, error } = await admin.from('instagram_connections').select('id').eq('instagram_id', event.accountId).not('access_token', 'is', null).maybeSingle();
    if (error) { console.error('[instagram webhook] connection lookup failed'); return new Response('Retry', { status: 500 }); }
    if (!connection) { console.warn('[instagram webhook] no active connection matched'); continue; }
    const result = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: event.participantId, p_meta_id: event.messageId, p_direction: event.direction, p_content: event.text, p_at: event.at });
    if (result.error) { console.error('[instagram webhook] message storage failed', result.error.code); return new Response('Retry', { status: 500 }); }
    console.info('[instagram webhook] message recorded');
  }
  return NextResponse.json({ ok: true });
}
