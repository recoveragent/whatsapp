import { NextResponse } from 'next/server';

import {
  extractLeadgenChanges,
  verifyMetaWebhookSignature,
} from '@/lib/meta/lead-ads';
import { ingestMetaLead } from '@/lib/meta/lead-ingest';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const expected = process.env.META_LEADS_VERIFY_TOKEN;

  if (mode === 'subscribe' && challenge && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return NextResponse.json(
    { error: 'Verification token mismatch' },
    { status: 403 }
  );
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const appSecret = process.env.META_APP_SECRET ?? '';
  if (
    !verifyMetaWebhookSignature(
      rawBody,
      request.headers.get('x-hub-signature-256'),
      appSecret
    )
  ) {
    return NextResponse.json(
      { error: 'Invalid webhook signature' },
      { status: 401 }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const changes = extractLeadgenChanges(payload);
  if (changes.length === 0)
    return NextResponse.json({ received: true, processed: 0 });

  try {
    const db = supabaseAdmin();
    const results = [];
    for (const change of changes) {
      results.push(await ingestMetaLead(db, change, payload));
    }
    return NextResponse.json({
      received: true,
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('[meta-leads] webhook failed:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Lead ingestion failed',
      },
      { status: 500 }
    );
  }
}
