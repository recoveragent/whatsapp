import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  parseGuidanceInput,
  REPLY_GUIDANCE_COLUMNS,
} from '@/lib/ai/reply-guidance';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const { data, error } = await supabase
      .from('ai_reply_guidance')
      .select(REPLY_GUIDANCE_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ guidance: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Save a correction for an AI reply. The customer message and AI reply
 * are read server-side from the thread (not trusted from the client):
 * the AI reply is `message_id`, the example is the customer's latest
 * text message before it.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount('admin');
    const rate = checkRateLimit(`ai-reply-guidance:${accountId}`, {
      windowMs: 60_000,
      limit: 20,
    });
    if (!rate.success) return rateLimitResponse(rate);

    const body = await request.json().catch(() => null);
    const messageId =
      body && typeof body.message_id === 'string' ? body.message_id : '';
    const parsed = parseGuidanceInput({ ...body, customer_message: '', ai_reply: '' });
    if ('error' in parsed)
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (!messageId)
      return NextResponse.json({ error: 'Missing message.' }, { status: 400 });

    const { data: reply, error: replyErr } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, content_text, ai_generated, created_at, conversations!inner(account_id)'
      )
      .eq('id', messageId)
      .eq('conversations.account_id', accountId)
      .maybeSingle();
    if (replyErr) throw replyErr;
    if (!reply || !reply.ai_generated)
      return NextResponse.json(
        { error: 'Only AI replies can be trained.' },
        { status: 404 }
      );

    const { data: customer, error: customerErr } = await supabase
      .from('messages')
      .select('content_text')
      .eq('conversation_id', reply.conversation_id)
      .eq('sender_type', 'customer')
      .lt('created_at', reply.created_at)
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (customerErr) throw customerErr;

    const input = parseGuidanceInput({
      instruction: parsed.instruction,
      customer_message: customer?.content_text ?? '',
      ai_reply: reply.content_text ?? '',
    });
    if ('error' in input)
      return NextResponse.json({ error: input.error }, { status: 400 });

    const { data, error } = await supabase
      .from('ai_reply_guidance')
      .insert({
        account_id: accountId,
        message_id: reply.id,
        conversation_id: reply.conversation_id,
        ...input,
      })
      .select(REPLY_GUIDANCE_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ guidance: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
