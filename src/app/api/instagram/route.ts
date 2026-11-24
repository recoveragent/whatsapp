import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const admin = supabaseAdmin();
    const { data: connections, error } = await admin.from('instagram_connections').select('id,username').eq('account_id', ctx.accountId).not('access_token', 'is', null);
    if (error) throw error;
    const threadId = new URL(request.url).searchParams.get('thread');
    if (threadId) {
      if (!/^[0-9a-f-]{36}$/i.test(threadId)) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 });
      const { data, error: messagesError } = await ctx.supabase.from('instagram_messages').select('id,direction,content,created_at').eq('account_id', ctx.accountId).eq('thread_id', threadId).order('created_at', { ascending: false }).limit(500);
      if (messagesError) throw messagesError;
      return NextResponse.json({ messages: (data ?? []).reverse() });
    }
    const { data: threads, error: threadError } = await ctx.supabase.from('instagram_threads').select('id,connection_id,participant_id,participant_username,last_message_text,last_message_at,last_inbound_at').eq('account_id', ctx.accountId).order('last_message_at', { ascending: false }).limit(100);
    if (threadError) throw threadError;
    return NextResponse.json({ connections, threads });
  } catch (error) { return toErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await request.json();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid connection' }, { status: 400 });
    const { data, error } = await supabaseAdmin().from('instagram_connections').update({ access_token: null }).eq('account_id', ctx.accountId).eq('id', id).not('access_token', 'is', null).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`instagram-send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json();
    const threadId = typeof body.thread_id === 'string' ? body.thread_id : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(threadId) || !text || text.length > 1000) return NextResponse.json({ error: 'Enter a message of up to 1,000 characters.' }, { status: 400 });
    const { data: thread, error } = await ctx.supabase.from('instagram_threads').select('id,connection_id,participant_id,last_inbound_at').eq('account_id', ctx.accountId).eq('id', threadId).maybeSingle();
    if (error) throw error;
    if (!thread) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (!thread.last_inbound_at || Date.now() - Date.parse(thread.last_inbound_at) > 24 * 60 * 60 * 1000) return NextResponse.json({ error: 'The 24-hour reply window has closed.' }, { status: 400 });
    const admin = supabaseAdmin();
    const { data: connection, error: configError } = await admin.from('instagram_connections').select('id,instagram_id,access_token').eq('account_id', ctx.accountId).eq('id', thread.connection_id).maybeSingle();
    if (configError) throw configError;
    if (!connection?.access_token) return NextResponse.json({ error: 'Instagram is disconnected.' }, { status: 400 });
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/v27.0/${encodeURIComponent(connection.instagram_id)}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${decrypt(connection.access_token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: thread.participant_id }, message: { text } }) });
    } catch {
      return NextResponse.json({ error: 'The delivery result is unknown. Check Instagram before trying again.' }, { status: 502 });
    }
    const result = await response.json().catch(() => null);
    if (!result) return NextResponse.json({ error: 'The delivery result is unknown. Check Instagram before trying again.' }, { status: 502 });
    if (!response.ok || typeof result.message_id !== 'string') return NextResponse.json({ error: 'Meta could not send the message. Check your connection and try again.' }, { status: 502 });
    const saved = await admin.rpc('instagram_record_message', { p_connection: connection.id, p_participant: thread.participant_id, p_meta_id: result.message_id, p_direction: 'outbound', p_content: text, p_at: new Date().toISOString() });
    if (saved.error) return NextResponse.json({ error: 'Meta accepted the message, but it could not be saved. Do not resend until you check Instagram.' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (error) { return toErrorResponse(error); }
}
