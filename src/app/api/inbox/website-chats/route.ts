import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const session = new URL(request.url).searchParams.get('session');
    if (session) {
      if (!/^[0-9a-f-]{36}$/i.test(session)) return NextResponse.json({ error: 'Invalid chat' }, { status: 400 });
      const { data, error } = await supabase.from('website_chat_messages')
        .select('id, role, content, created_at').eq('account_id', accountId).eq('session_id', session)
        .order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return NextResponse.json({ messages: (data ?? []).reverse() });
    }
    const search = new URL(request.url).searchParams.get('search')?.trim().slice(0, 100) ?? '';
    let query = supabase.from('website_chat_sessions')
      .select('id, last_message_at, last_message_text, created_at, phone').eq('account_id', accountId);
    if (search) {
      const escaped = search.replace(/[\\%_]/g, (character) => `\\${character}`);
      const { data: matches, error: matchError } = await supabase.from('website_chat_messages')
        .select('session_id').eq('account_id', accountId).eq('role', 'user').ilike('content', `%${escaped}%`)
        .order('created_at', { ascending: false }).limit(1000);
      if (matchError) throw matchError;
      const ids = [...new Set((matches ?? []).map((row) => row.session_id))];
      if (!ids.length) return NextResponse.json({ chats: [] });
      query = query.in('id', ids);
    }
    const { data, error } = await query.order('last_message_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ chats: data ?? [] });
  } catch (error) { return toErrorResponse(error); }
}
