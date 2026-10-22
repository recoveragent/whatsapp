import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingColumnError } from '@/lib/auth/brand-accounts'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import type { AiAgentNodeConfig, FlowRunRow } from './types'

/** Meta's customer-service window: free-form replies only within 24h. */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * `ai_agent` node: end the run and give the conversation to the AI agent.
 *
 * Turns auto-reply back on for this thread (a prior AI handoff may have
 * paused it), resets its per-conversation reply budget, and stores the
 * node's goal so every AI reply on the thread works towards it. The
 * goal is cleared when the agent hands off to a human.
 *
 * With `respond_now` (the default), when the customer's message is the
 * latest in the thread — the flow was started by an inbound — the agent
 * answers it immediately instead of waiting for the next message. Flows
 * started by store events (abandoned checkout, order placed) end with
 * our own outbound, so the agent simply waits for the customer to reply.
 *
 * The AI only replies when the brand has AI Agents enabled with
 * auto-replies on; otherwise the thread stays with the team as usual.
 */
export async function handOffRunToAiAgent(
  db: SupabaseClient,
  run: FlowRunRow,
  cfg: AiAgentNodeConfig,
  goal: string
): Promise<{ responded: boolean }> {
  if (!run.conversation_id || !run.contact_id) return { responded: false }

  const update: Record<string, unknown> = {
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_handoff_summary: null,
    ai_flow_goal: goal.trim().slice(0, 2000) || null,
  }
  let { error } = await db
    .from('conversations')
    .update(update)
    .eq('id', run.conversation_id)
  if (isMissingColumnError(error, 'ai_flow_goal')) {
    delete update.ai_flow_goal
    ;({ error } = await db
      .from('conversations')
      .update(update)
      .eq('id', run.conversation_id))
  }
  if (error) throw new Error(`ai_agent: could not update conversation: ${error.message}`)

  if (cfg.respond_now === false) return { responded: false }
  if (!(await customerSpokeLast(db, run.conversation_id))) return { responded: false }

  await dispatchInboundToAiReply({
    accountId: run.account_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    configOwnerUserId: run.user_id,
  })
  return { responded: true }
}

async function customerSpokeLast(
  db: SupabaseClient,
  conversationId: string
): Promise<boolean> {
  const { data } = await db
    .from('messages')
    .select('sender_type, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data || data.sender_type !== 'customer') return false
  return Date.now() - new Date(data.created_at).getTime() < SESSION_WINDOW_MS
}
