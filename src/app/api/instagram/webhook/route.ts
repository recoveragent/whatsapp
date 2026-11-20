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

type LogFields = { secret_match?: string; object?: string; entry_ids?: string[]; item_keys?: string[]; events?: number };

/** Temporary delivery diagnostics (see migration instagram_webhook_log). Never stores message text. */
async function logDelivery(status: number, reason: string, fields: LogFields = {}) {
  try {
    await supabaseAdmin().from('instagram_webhook_log').insert({ status, reason, instagram_secret_set: Boolean(process.env.INSTAGRAM_APP_SECRET), ...fields });
  } catch { /* diagnostics must never break delivery */ }
}

function payloadShape(payload: unknown): LogFields {
  const body = payload as { object?: unknown; entry?: unknown } | null;
  const entries = Array.isArray(body?.entry) ? (body!.entry as Record<string, unknown>[]) : [];
  const first = entries[0] ?? {};
  const item = (Array.isArray(first.messaging) ? first.messaging[0] : Array.isArray(first.changes) ? first.changes[0] : undefined) as Record<string, unknown> | undefined;
  const keys = item ? Object.keys(item).concat(item.message && typeof item.message === 'object' ? Object.keys(item.message).map((k) => `message.${k}`) : [], item.value && typeof item.value === 'object' ? Object.keys(item.value).map((k) => `value.${k}`) : []) : [];
  return {
    object: typeof body?.object === 'string' ? body.object : undefined,
    entry_ids: entries.map((e) => String(e?.id ?? '')).slice(0, 10),
    item_keys: [Array.isArray(first.messaging) ? 'messaging' : Array.isArray(first.changes) ? 'changes' : 'none', ...keys].slice(0, 30),
  };
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  // Webhooks configured under the Instagram use case are signed with the
  // Instagram app secret, not the parent Meta app secret. Accept either.
  const instagramSecret = process.env.INSTAGRAM_APP_SECRET;
  const secretMatch = verifyMetaWebhookSignature(raw, signature) ? 'meta' : instagramSecret && verifyMetaWebhookSignature(raw, signature, instagramSecret) ? 'instagram' : 'none';
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const shape = payloadShape(payload);
  if (secretMatch === 'none') {
    console.warn('[instagram webhook] signature rejected (checked META_APP_SECRET and INSTAGRAM_APP_SECRET)');
    await logDelivery(401, signature ? 'bad_signature' : 'missing_signature', { secret_match: secretMatch, ...shape });
    return new Response('Unauthorized', { status: 401 });
  }
  if (payload === null) {
    console.warn('[instagram webhook] invalid JSON');
    await logDelivery(400, 'bad_json', { secret_match: secretMatch });
    return new Response('Bad request', { status: 400 });
  }
  const admin = supabaseAdmin();
  const events = parseInstagramEvents(payload);
  console.info('[instagram webhook] received', JSON.stringify({ instagram: (payload as { object?: unknown })?.object === 'instagram', events: events.length, secret: secretMatch }));
  let saved = 0;
  for (const event of events) {
    const { data: connection, error } = await admin.from('instagram_connections').select('id').eq('instagram_id', event.accountId).not('access_token', 'is', null).maybeSingle();
    if (error) {
      console.error('[instagram webhook] connection lookup failed');
      await logDelivery(500, 'connection_lookup_failed', { secret_match: secretMatch, ...shape, events: events.length });
      return new Response('Retry', { status: 500 });
    }
    if (!connection) { console.warn('[instagram webhook] no active connection matched'); continue; }
    const result = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: event.participantId, p_meta_id: event.messageId, p_direction: event.direction, p_content: event.text, p_at: event.at });
    if (result.error) {
      console.error('[instagram webhook] message storage failed', result.error.code);
      await logDelivery(500, 'record_failed', { secret_match: secretMatch, ...shape, events: events.length });
      return new Response('Retry', { status: 500 });
    }
    saved++;
    console.info('[instagram webhook] message recorded');
  }
  await logDelivery(200, events.length === 0 ? 'no_events_parsed' : saved === 0 ? 'no_matching_connection' : `saved_${saved}`, { secret_match: secretMatch, ...shape, events: events.length });
  return NextResponse.json({ ok: true });
}
