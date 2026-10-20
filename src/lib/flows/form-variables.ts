import type { TemplateVariableGroup } from './template-variables'

type NodeLike = { node_key: string; node_type: string; config: Record<string, unknown> }

/**
 * Variable-picker groups for WhatsApp Form submissions captured by
 * send_flow nodes — one group per form, one option per field key.
 */
export function formFieldVariableGroups(
  nodes: NodeLike[],
  currentKey?: string,
): TemplateVariableGroup[] {
  const groups: TemplateVariableGroup[] = []
  for (const n of nodes) {
    if (n.node_type !== 'send_flow' || n.node_key === currentKey) continue
    const varKey = typeof n.config.var_key === 'string' ? n.config.var_key.trim() : ''
    if (!varKey) continue
    const fields = Array.isArray(n.config.flow_fields)
      ? (n.config.flow_fields as Array<{ key?: unknown; label?: unknown }>)
      : []
    const name = typeof n.config.flow_name === 'string' && n.config.flow_name ? n.config.flow_name : varKey
    groups.push({
      id: `form:${n.node_key}`,
      label: `Form: ${name}`,
      options: [
        { label: 'All answers', token: `{{vars.${varKey}}}`, type: 'text' },
        ...fields
          .filter((f): f is { key: string; label?: unknown } => typeof f.key === 'string' && !!f.key)
          .map((f) => ({
            label: typeof f.label === 'string' && f.label ? f.label : f.key,
            token: `{{vars.${varKey}.${f.key}}}`,
            type: 'text' as const,
          })),
      ],
    })
  }
  return groups
}
