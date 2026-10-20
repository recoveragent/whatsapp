import { describe, expect, it } from 'vitest'
import type { BuilderNode } from '@/components/flows/shared'
import { formConditionSources } from './form-variables'

const node = (node_key: string, node_type: string, config: Record<string, unknown>) =>
  ({ node_key, node_type, config }) as unknown as BuilderNode

describe('formConditionSources', () => {
  const plan = { key: 'plan', label: 'Plan', options: [{ id: 'basic', title: 'Basic' }] }

  it('returns forms that lead into the condition, nearest first', () => {
    const nodes = [
      node('lead', 'send_flow', { var_key: 'lead', flow_name: 'Lead', next_node_key: 'ask' }),
      node('ask', 'send_flow', { var_key: 'form', flow_id: '42', flow_name: 'Guidance', flow_fields: [plan], next_node_key: 'branch' }),
      node('other', 'send_flow', { var_key: 'other', next_node_key: 'thanks' }),
      node('branch', 'switch', { branches: [] }),
      node('thanks', 'send_message', {}),
    ]
    expect(formConditionSources(nodes, 'branch')).toEqual([
      { node_key: 'ask', var_key: 'form', flow_id: '42', name: 'Guidance', fields: [plan] },
      { node_key: 'lead', var_key: 'lead', name: 'Lead', fields: [] },
    ])
  })

  it('falls back to every form when none is connected', () => {
    const nodes = [
      node('ask', 'send_flow', { var_key: 'form' }),
      node('nameless', 'send_flow', { var_key: '' }),
      node('branch', 'condition', {}),
    ]
    expect(formConditionSources(nodes, 'branch').map((f) => f.node_key)).toEqual(['ask'])
  })
})
