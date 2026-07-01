import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { inboxDbErrorMessage } from '@/lib/inbox/db-errors';
import { hasPrivateNotesTable, loadConversationContactId } from '@/lib/inbox/tables';
import type { ConversationPrivateNote } from '@/types';

type RouteContext = { params: Promise<{ id: string }> };

async function loadConversation(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase'],
  accountId: string,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

function mapContactNote(row: {
  id: string;
  contact_id: string;
  user_id: string;
  note_text: string;
  created_at: string;
}, conversationId: string): ConversationPrivateNote {
  return {
    id: row.id,
    conversation_id: conversationId,
    user_id: row.user_id,
    note_text: row.note_text,
    created_at: row.created_at,
  };
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const ctx = await getCurrentAccount();
    const { id: conversationId } = await context.params;

    const conv = await loadConversation(ctx.supabase, ctx.accountId, conversationId);
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const db = supabaseAdmin();

    if (await hasPrivateNotesTable()) {
      const { data, error } = await db
        .from('conversation_private_notes')
        .select('id, conversation_id, user_id, note_text, created_at')
        .eq('conversation_id', conversationId)
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) {
        return NextResponse.json({ error: inboxDbErrorMessage(error) }, { status: 500 });
      }

      return NextResponse.json({ notes: data ?? [] });
    }

    const contactId = await loadConversationContactId(ctx.supabase, ctx.accountId, conversationId);
    if (!contactId) {
      return NextResponse.json({ notes: [] });
    }

    const { data, error } = await db
      .from('contact_notes')
      .select('id, contact_id, user_id, note_text, created_at')
      .eq('contact_id', contactId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ error: inboxDbErrorMessage(error) }, { status: 500 });
    }

    return NextResponse.json({
      notes: (data ?? []).map((row) => mapContactNote(row, conversationId)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('agent');
    const { id: conversationId } = await context.params;
    const body = (await req.json()) as { note_text?: string };

    const noteText = String(body.note_text ?? '').trim();
    if (!noteText) {
      return NextResponse.json({ error: 'Note text is required' }, { status: 400 });
    }

    const conv = await loadConversation(ctx.supabase, ctx.accountId, conversationId);
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const db = supabaseAdmin();

    if (await hasPrivateNotesTable()) {
      const { data, error } = await db
        .from('conversation_private_notes')
        .insert({
          conversation_id: conversationId,
          account_id: ctx.accountId,
          user_id: ctx.userId,
          note_text: noteText,
        })
        .select('id, conversation_id, user_id, note_text, created_at')
        .single();

      if (error || !data) {
        console.error('[private-notes] insert failed:', error);
        return NextResponse.json(
          { error: inboxDbErrorMessage(error) },
          { status: 500 },
        );
      }

      return NextResponse.json(data);
    }

    const contactId = await loadConversationContactId(ctx.supabase, ctx.accountId, conversationId);
    if (!contactId) {
      return NextResponse.json({ error: 'Conversation has no contact' }, { status: 400 });
    }

    const { data, error } = await db
      .from('contact_notes')
      .insert({
        contact_id: contactId,
        account_id: ctx.accountId,
        user_id: ctx.userId,
        note_text: noteText,
      })
      .select('id, contact_id, user_id, note_text, created_at')
      .single();

    if (error || !data) {
      console.error('[private-notes] contact_notes fallback failed:', error);
      return NextResponse.json(
        { error: inboxDbErrorMessage(error) },
        { status: 500 },
      );
    }

    return NextResponse.json(mapContactNote(data, conversationId));
  } catch (err) {
    return toErrorResponse(err);
  }
}
