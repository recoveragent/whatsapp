import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  createReminder,
  listCompletedReminders,
  listConversationReminders,
  listDueReminders,
  listPendingReminders,
  REMINDER_NOTE_MAX_LENGTH,
} from '@/lib/inbox/reminders'

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversation_id')?.trim()
    const scope = searchParams.get('scope') ?? 'due'

    if (conversationId) {
      const reminders = await listConversationReminders(
        ctx.supabase,
        ctx.accountId,
        conversationId,
      )
      return NextResponse.json({ reminders })
    }

    if (scope === 'history') {
      const history = await listCompletedReminders(ctx.supabase, ctx.accountId)
      return NextResponse.json({ reminders: history, history })
    }

    if (scope === 'all') {
      const [reminders, history] = await Promise.all([
        listPendingReminders(ctx.supabase, ctx.accountId),
        listCompletedReminders(ctx.supabase, ctx.accountId),
      ])
      return NextResponse.json({ reminders, history })
    }

    if (scope === 'pending') {
      const reminders = await listPendingReminders(ctx.supabase, ctx.accountId)
      return NextResponse.json({ reminders })
    }

    const reminders = await listDueReminders(ctx.supabase, ctx.accountId)
    return NextResponse.json({ reminders })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json()) as {
      conversation_id?: string
      due_at?: string
      note?: string
    }

    const conversationId = body.conversation_id?.trim()
    const note = body.note?.trim() ?? ''
    const dueAtRaw = body.due_at?.trim()

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }
    if (!note) {
      return NextResponse.json({ error: 'note is required' }, { status: 400 })
    }
    if (note.length > REMINDER_NOTE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `note must be at most ${REMINDER_NOTE_MAX_LENGTH} characters` },
        { status: 400 },
      )
    }
    if (!dueAtRaw) {
      return NextResponse.json({ error: 'due_at is required' }, { status: 400 })
    }

    const dueAt = new Date(dueAtRaw)
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: 'due_at is invalid' }, { status: 400 })
    }
    if (dueAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'due_at must be in the future' },
        { status: 400 },
      )
    }

    const { data: conversation, error: loadError } = await ctx.supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (loadError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const reminder = await createReminder(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      note,
      dueAt: dueAt.toISOString(),
    })

    return NextResponse.json(reminder, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
