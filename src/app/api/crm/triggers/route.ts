import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  dispatchConversationAssigned,
  dispatchTagAdded,
} from '@/lib/crm/dispatch-triggers'

/**
 * POST /api/crm/triggers — fire automations + flows for CRM events.
 */
export async function POST(request: Request) {
  let accountId: string
  try {
    const ctx = await getCurrentAccount()
    accountId = ctx.accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body?.trigger_type || !body?.contact_id) {
    return NextResponse.json(
      { error: 'trigger_type and contact_id required' },
      { status: 400 },
    )
  }

  if (body.trigger_type === 'tag_added') {
    if (!body.tag_id) {
      return NextResponse.json({ error: 'tag_id required' }, { status: 400 })
    }
    dispatchTagAdded({
      accountId,
      contactId: body.contact_id,
      tagId: body.tag_id,
      conversationId: body.conversation_id,
    })
  } else if (body.trigger_type === 'conversation_assigned') {
    if (!body.conversation_id || !body.agent_id) {
      return NextResponse.json(
        { error: 'conversation_id and agent_id required' },
        { status: 400 },
      )
    }
    dispatchConversationAssigned({
      accountId,
      contactId: body.contact_id,
      conversationId: body.conversation_id,
      agentId: body.agent_id,
    })
  } else {
    return NextResponse.json({ error: 'Unsupported trigger_type' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
