/**
 * Fire automations + flows for CRM events (tag added, conversation assigned).
 * Server-only — call from API routes or the flows engine.
 */

import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { runFlowsForTrigger } from '@/lib/flows/dispatch-external'

function logDispatchError(label: string, err: unknown) {
  console.error(`[crm-triggers] ${label}:`, err)
}

export function dispatchTagAdded(args: {
  accountId: string
  contactId: string
  tagId: string
  conversationId?: string
}): void {
  const context = {
    tag_id: args.tagId,
    conversation_id: args.conversationId,
  }
  runAutomationsForTrigger({
    accountId: args.accountId,
    triggerType: 'tag_added',
    contactId: args.contactId,
    context,
  }).catch((err) => logDispatchError('tag_added automation', err))

  runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: 'tag_added',
    contactId: args.contactId,
    conversationId: args.conversationId,
    context: { tag_id: args.tagId },
  }).catch((err) => logDispatchError('tag_added flow', err))
}

export function dispatchConversationAssigned(args: {
  accountId: string
  contactId: string
  conversationId: string
  agentId: string
}): void {
  const context = {
    agent_id: args.agentId,
    conversation_id: args.conversationId,
  }
  runAutomationsForTrigger({
    accountId: args.accountId,
    triggerType: 'conversation_assigned',
    contactId: args.contactId,
    context,
  }).catch((err) => logDispatchError('conversation_assigned automation', err))

  runFlowsForTrigger({
    accountId: args.accountId,
    triggerType: 'conversation_assigned',
    contactId: args.contactId,
    conversationId: args.conversationId,
    context: { agent_id: args.agentId, conversation_id: args.conversationId },
  }).catch((err) => logDispatchError('conversation_assigned flow', err))
}
