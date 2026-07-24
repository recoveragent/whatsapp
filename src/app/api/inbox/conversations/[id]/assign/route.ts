import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { inboxDbErrorMessage } from '@/lib/inbox/db-errors'
import {
  insertAssignmentSystemMessage,
  resolveAgentDisplayName,
  type AssignmentChange,
} from '@/lib/inbox/status-system-message'

/**
 * PATCH /api/inbox/conversations/[id]/assign
 * Body: { assigned_agent_id: string | null }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const body = (await request.json()) as {
      assigned_agent_id?: string | null
    }

    if (!('assigned_agent_id' in body)) {
      return NextResponse.json(
        { error: 'assigned_agent_id is required (string or null)' },
        { status: 400 },
      )
    }

    const nextAssignee =
      body.assigned_agent_id === null || body.assigned_agent_id === ''
        ? null
        : String(body.assigned_agent_id)

    const { data: conversation, error: loadError } = await ctx.supabase
      .from('conversations')
      .select('id, assigned_agent_id, contact_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (loadError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const prev = (conversation.assigned_agent_id as string | null) ?? null
    if (prev === nextAssignee) {
      return NextResponse.json({
        id: conversation.id,
        assigned_agent_id: prev,
        system_message: null,
      })
    }

    if (nextAssignee) {
      const { data: member } = await ctx.supabase
        .from('profiles')
        .select('user_id')
        .eq('user_id', nextAssignee)
        .eq('account_id', ctx.accountId)
        .maybeSingle()

      // Super-admin acting in a brand may not have a profile row on that
      // brand — still allow assigning themselves; teammates must belong.
      if (!member && nextAssignee !== ctx.userId) {
        return NextResponse.json(
          { error: 'Assignee is not a member of this brand' },
          { status: 400 },
        )
      }
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .update({
        assigned_agent_id: nextAssignee,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: inboxDbErrorMessage(error) ?? 'Failed to update assignment' },
        { status: 500 },
      )
    }

    const actorName = await resolveAgentDisplayName(ctx.supabase, ctx.userId)
    let change: AssignmentChange
    if (!nextAssignee) {
      change = { kind: 'unassign', actorName }
    } else if (nextAssignee === ctx.userId) {
      change = { kind: 'self', actorName }
    } else {
      const assigneeName = await resolveAgentDisplayName(ctx.supabase, nextAssignee)
      change = { kind: 'assign', actorName, assigneeName }
    }

    const systemMessage = await insertAssignmentSystemMessage({
      db: ctx.supabase,
      conversationId: id,
      change,
      actorUserId: ctx.userId,
    })

    return NextResponse.json({
      ...data,
      system_message: systemMessage,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
