import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { inboxDbErrorMessage } from '@/lib/inbox/db-errors'
import {
  followupScheduledAt,
  getFollowupSettings,
} from '@/lib/inbox/followup'
import {
  insertConversationStatusMessage,
  resolveAgentDisplayName,
} from '@/lib/inbox/status-system-message'
import type { ConversationStatus } from '@/types'

const ALLOWED: ConversationStatus[] = ['open', 'closed', 'followup']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const body = (await request.json()) as { status?: ConversationStatus }

    if (!body.status || !ALLOWED.includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be one of: open, closed, followup' },
        { status: 400 },
      )
    }

    const { data: conversation, error: loadError } = await ctx.supabase
      .from('conversations')
      .select('id, status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (loadError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (conversation.status === body.status) {
      return NextResponse.json(conversation)
    }

    const patch: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    }

    if (body.status === 'followup') {
      const settings = await getFollowupSettings(ctx.supabase, ctx.accountId)
      patch.followup_scheduled_at = followupScheduledAt(settings.delay_hours)
      patch.followup_sent_at = null
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: inboxDbErrorMessage(error) ?? 'Failed to update status' },
        { status: 500 },
      )
    }

    const agentName = await resolveAgentDisplayName(ctx.supabase, ctx.userId)
    const systemMessage = await insertConversationStatusMessage({
      db: ctx.supabase,
      conversationId: id,
      status: body.status,
      actor: { kind: 'agent', name: agentName, userId: ctx.userId },
    })

    return NextResponse.json({
      ...data,
      system_message: systemMessage,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
