import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { canSendMessages } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { startFlowForExternalEvent } from '@/lib/flows/engine'
import { applyFlowExitEventWithClient } from '@/lib/flows/apply-exit'
import type { FlowRow } from '@/lib/flows/types'

/**
 * POST /api/flows/[id]/start
 *
 * Manually start an active conversational flow for a contact in the
 * inbox — skips the flow's normal trigger (keyword, webhook, etc.).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: flowId } = await context.params
    const ctx = await getCurrentAccount()
    if (!canSendMessages(ctx.role)) {
      throw new ForbiddenError('Your role cannot start flows')
    }

    const body = await request.json().catch(() => ({}))
    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : ''

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    const { data: conversation, error: convError } = await ctx.supabase
      .from('conversations')
      .select('id, contact_id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      )
    }

    const assigneeId =
      (conversation.assigned_agent_id as string | null) ?? null
    if (!assigneeId || assigneeId !== ctx.userId) {
      return NextResponse.json(
        {
          error: assigneeId
            ? 'This chat is assigned to someone else — reassign it to yourself before starting a flow'
            : 'Self-assign this chat before starting a flow',
        },
        { status: 403 },
      )
    }

    const contactId = conversation.contact_id as string | null
    if (!contactId) {
      return NextResponse.json(
        { error: 'Conversation has no contact' },
        { status: 400 },
      )
    }

    const { data: flow, error: flowError } = await ctx.supabase
      .from('flows')
      .select('*')
      .eq('id', flowId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (flowError || !flow) {
      return NextResponse.json({ error: 'Flow not found' }, { status: 404 })
    }

    const flowRow = flow as FlowRow
    if (flowRow.status !== 'active') {
      return NextResponse.json(
        { error: 'Only active flows can be started manually' },
        { status: 400 },
      )
    }
    if (!flowRow.entry_node_id) {
      return NextResponse.json(
        { error: 'Flow has no entry node — activate it in the Flow Builder first' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()

    await applyFlowExitEventWithClient(db, {
      accountId: ctx.accountId,
      contactId,
      event: { type: 'another_flow', incomingFlowId: flowRow.id },
      exceptFlowId: flowRow.id,
    })

    const result = await startFlowForExternalEvent({
      flow: flowRow,
      contactId,
      conversationId,
      initialVars: { manual_start: true },
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: 'Flow could not be started — check the flow graph in the builder' },
        { status: 422 },
      )
    }

    return NextResponse.json({
      success: true,
      flow_id: flowRow.id,
      flow_name: flowRow.name,
      flow_run_id: result.flow_run_id ?? null,
    })
  } catch (error) {
    console.error('[flows/start] POST failed:', error)
    return toErrorResponse(error)
  }
}
