import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { repairMissingFlowPromptForConversation } from '@/lib/flows/backfill-outbound-prompt'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const { data: conversation, error: loadError } = await ctx.supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (loadError || !conversation?.contact_id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const result = await repairMissingFlowPromptForConversation({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
    })

    return NextResponse.json({
      repaired: result.repaired_count > 0,
      repaired_count: result.repaired_count,
      message_ids: result.message_ids,
      // Back-compat for callers that read a single id.
      message_id: result.message_ids[0] ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
