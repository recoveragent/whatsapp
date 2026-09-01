import { describe, expect, it } from 'vitest'

import { matchReplyId } from './engine'
import {
  inboundReplyMatchesNode,
  routeInboundToActiveRun,
} from './inbound-router'
import type { FlowNodeRow, FlowRunRow } from './types'

const run = (id: string, flowId: string, nodeKey: string): FlowRunRow =>
  ({
    id,
    flow_id: flowId,
    current_node_key: nodeKey,
    last_advanced_at: '2026-09-01T10:00:00Z',
  }) as FlowRunRow

describe('routeInboundToActiveRun', () => {
  const codNode: FlowNodeRow = {
    node_key: 'send_template',
    node_type: 'send_template',
    config: {
      buttons: [
        { reply_id: 'confirm', title: 'Confirm', next_node_key: 'confirmed' },
      ],
    },
  } as unknown as FlowNodeRow

  const supportNode: FlowNodeRow = {
    node_key: 'collect',
    node_type: 'collect_input',
    config: { var_key: 'issue', next_node_key: 'next' },
  } as unknown as FlowNodeRow

  it('routes button tap to the matching run', () => {
    const picked = routeInboundToActiveRun(
      [
        { run: run('run-new', 'flow-b', 'collect'), currentNode: supportNode },
        { run: run('run-old', 'flow-a', 'send_template'), currentNode: codNode },
      ],
      {
        kind: 'interactive_reply',
        reply_id: 'confirm',
        reply_title: 'Confirm',
        meta_message_id: 'wamid.1',
      },
      matchReplyId,
    )
    expect(picked?.id).toBe('run-old')
  })

  it('prefers the first candidate when multiple runs could match', () => {
    const picked = routeInboundToActiveRun(
      [
        { run: run('run-a', 'flow-a', 'send_template'), currentNode: codNode },
        { run: run('run-b', 'flow-b', 'send_template'), currentNode: codNode },
      ],
      {
        kind: 'interactive_reply',
        reply_id: 'confirm',
        reply_title: 'Confirm',
        meta_message_id: 'wamid.2',
      },
      matchReplyId,
    )
    expect(picked?.id).toBe('run-a')
  })
})

describe('inboundReplyMatchesNode', () => {
  it('matches collect_input on any non-empty text', () => {
    const node = {
      node_key: 'collect',
      node_type: 'collect_input',
      config: {},
    } as unknown as FlowNodeRow
    expect(
      inboundReplyMatchesNode(
        { kind: 'text', text: 'Need help', meta_message_id: 'wamid.3' },
        node,
        matchReplyId,
      ),
    ).toBe(true)
  })
})
