import { isSuspendingNodeType } from './reply-timeout'
import type { FlowNodeRow, FlowRunRow, ParsedInbound } from './types'

export type InboundRunCandidate = {
  run: FlowRunRow
  currentNode: FlowNodeRow | null
}

type MatchReplyIdFn = (
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
  reply_title?: string,
) => string | null

/**
 * Returns true when this inbound message would advance the run at its
 * current node (button tap, template quick reply, collect_input, etc.).
 */
export function inboundReplyMatchesNode(
  message: ParsedInbound,
  node: FlowNodeRow,
  matchReplyId: MatchReplyIdFn,
): boolean {
  if (
    message.kind === 'interactive_reply' &&
    (node.node_type === 'send_buttons' ||
      node.node_type === 'send_list' ||
      node.node_type === 'send_template')
  ) {
    return (
      matchReplyId(node, message.reply_id, message.reply_title) != null
    )
  }

  if (message.kind === 'text' && node.node_type === 'send_template') {
    const trimmed = message.text.trim()
    if (!trimmed) return false
    return matchReplyId(node, trimmed, trimmed) != null
  }

  if (message.kind === 'text' && node.node_type === 'collect_input') {
    return message.text.trim().length > 0
  }

  if (message.kind === 'address_reply' && node.node_type === 'send_address') {
    return message.formatted.trim().length > 0
  }

  if (message.kind === 'form_reply' && node.node_type === 'send_flow') {
    return Object.keys(message.values).length > 0 || message.formatted.trim().length > 0
  }

  return false
}

/**
 * Parse the token the engine attaches to send_flow messages
 * (`<run_id>:<node_key>:<sent_at_ms>`). Tokens from other senders
 * (CTWA lead forms, manual sends) return null.
 */
export function parseFlowFormToken(
  token: string | undefined,
): { runId: string; nodeKey: string } | null {
  if (!token) return null
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+):(\d+)$/i.exec(token)
  return m ? { runId: m[1]!, nodeKey: m[2]! } : null
}

/**
 * Pick the active run that should receive this inbound reply.
 * Candidates must be sorted newest `last_advanced_at` first.
 */
export function routeInboundToActiveRun(
  candidates: InboundRunCandidate[],
  message: ParsedInbound,
  matchReplyId: MatchReplyIdFn,
): FlowRunRow | null {
  // A form submission carrying our token belongs to exactly one run —
  // the one that sent it, still waiting on that node. A stale form
  // (run moved on or ended) must not advance some other run.
  const target =
    message.kind === 'form_reply' ? parseFlowFormToken(message.flow_token) : null
  if (target) {
    const hit = candidates.find(
      ({ run, currentNode }) =>
        run.id === target.runId &&
        run.current_node_key === target.nodeKey &&
        currentNode?.node_type === 'send_flow',
    )
    return hit && inboundReplyMatchesNode(message, hit.currentNode!, matchReplyId)
      ? hit.run
      : null
  }
  for (const { run, currentNode } of candidates) {
    if (!currentNode || !run.current_node_key) continue
    if (inboundReplyMatchesNode(message, currentNode, matchReplyId)) {
      return run
    }
  }
  return null
}

/** Most recent run that is waiting for customer input (fallback target). */
export function pickSuspendingRunForFallback(
  candidates: InboundRunCandidate[],
): FlowRunRow | null {
  for (const { run, currentNode } of candidates) {
    if (!currentNode || !run.current_node_key) continue
    if (isSuspendingNodeType(currentNode.node_type)) return run
  }
  return candidates[0]?.run ?? null
}
