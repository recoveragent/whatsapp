/**
 * Fire automations + flows for CRM events (tag added, conversation assigned).
 * Server-only — call from API routes or the flows engine.
 */

import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { runFlowsForTrigger } from '@/lib/flows/dispatch-external'
import { applyFlowExitEvent } from '@/lib/flows/apply-exit'

function logDispatchError(label: string, err: unknown) {
  console.error(`[crm-triggers] ${label}:`, err)
}

function fireInBackground(label: string, work: () => Promise<void>): void {
  work().catch((err) => logDispatchError(label, err))
}

export function dispatchTagAdded(args: {
  accountId: string
  contactId: string
  tagId: string
  conversationId?: string
  exceptRunId?: string
}): void {
  const context = {
    tag_id: args.tagId,
    conversation_id: args.conversationId,
  }
  fireInBackground('tag_added', async () => {
    await applyFlowExitEvent({
      accountId: args.accountId,
      contactId: args.contactId,
      event: { type: 'tag_added', tagId: args.tagId },
      exceptRunId: args.exceptRunId,
    })
    await runAutomationsForTrigger({
      accountId: args.accountId,
      triggerType: 'tag_added',
      contactId: args.contactId,
      context,
    })
    await runFlowsForTrigger({
      accountId: args.accountId,
      triggerType: 'tag_added',
      contactId: args.contactId,
      conversationId: args.conversationId,
      context: { tag_id: args.tagId },
    })
  })
}

export function dispatchTagRemoved(args: {
  accountId: string
  contactId: string
  tagId: string
  exceptRunId?: string
}): void {
  fireInBackground('tag_removed', async () => {
    await applyFlowExitEvent({
      accountId: args.accountId,
      contactId: args.contactId,
      event: { type: 'tag_removed', tagId: args.tagId },
      exceptRunId: args.exceptRunId,
    })
  })
}

export function dispatchConversationAssigned(args: {
  accountId: string
  contactId: string
  conversationId: string
  agentId: string
  exceptRunId?: string
}): void {
  const context = {
    agent_id: args.agentId,
    conversation_id: args.conversationId,
  }
  fireInBackground('conversation_assigned', async () => {
    await applyFlowExitEvent({
      accountId: args.accountId,
      contactId: args.contactId,
      event: { type: 'conversation_assigned' },
      exceptRunId: args.exceptRunId,
    })
    await runAutomationsForTrigger({
      accountId: args.accountId,
      triggerType: 'conversation_assigned',
      contactId: args.contactId,
      context,
    })
    await runFlowsForTrigger({
      accountId: args.accountId,
      triggerType: 'conversation_assigned',
      contactId: args.contactId,
      conversationId: args.conversationId,
      context: { agent_id: args.agentId, conversation_id: args.conversationId },
    })
  })
}

export function dispatchDealStageChanged(args: {
  accountId: string
  contactId: string
  stageId: string
  exceptRunId?: string
}): void {
  fireInBackground('deal_stage', async () => {
    await applyFlowExitEvent({
      accountId: args.accountId,
      contactId: args.contactId,
      event: { type: 'deal_stage', stageId: args.stageId },
      exceptRunId: args.exceptRunId,
    })
  })
}
