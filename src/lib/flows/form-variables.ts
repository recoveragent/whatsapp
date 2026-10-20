import type { BuilderNode } from '@/components/flows/shared'
import { deriveCanvasEdges } from './edges'
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

export interface FormConditionSource {
  node_key: string
  /** Answers live under `vars.<var_key>.<field>`. */
  var_key: string
  flow_id?: string
  name: string
  fields: Array<{ key: string; label?: string; options?: Array<{ id: string; title: string }> }>
}

/**
 * WhatsApp Form steps whose answers a condition at `currentKey` can test —
 * forms that lead into it first (nearest first), else every form in the flow
 * so a condition still works before it is wired up.
 */
export function formConditionSources(
  nodes: BuilderNode[],
  currentKey: string,
): FormConditionSource[] {
  const forms = new Map<string, FormConditionSource>()
  for (const n of nodes) {
    if (n.node_type !== 'send_flow' || n.node_key === currentKey) continue
    const cfg = n.config as Record<string, unknown>
    const varKey = typeof cfg.var_key === 'string' ? cfg.var_key.trim() : ''
    if (!varKey) continue
    const fields = (Array.isArray(cfg.flow_fields) ? cfg.flow_fields : []).filter(
      (f): f is FormConditionSource['fields'][number] =>
        !!f && typeof f === 'object' && typeof (f as { key?: unknown }).key === 'string' && !!(f as { key: string }).key,
    )
    forms.set(n.node_key, {
      node_key: n.node_key,
      var_key: varKey,
      ...(typeof cfg.flow_id === 'string' && cfg.flow_id ? { flow_id: cfg.flow_id } : {}),
      name: typeof cfg.flow_name === 'string' && cfg.flow_name ? cfg.flow_name : varKey,
      fields,
    })
  }
  if (forms.size === 0) return []

  // Walk edges backwards from the condition, breadth-first.
  const incoming = new Map<string, string[]>()
  for (const e of deriveCanvasEdges(nodes)) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])
  }
  const upstream: FormConditionSource[] = []
  const seen = new Set([currentKey])
  let frontier = [currentKey]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const key of frontier) {
      for (const src of incoming.get(key) ?? []) {
        if (seen.has(src)) continue
        seen.add(src)
        const form = forms.get(src)
        if (form) upstream.push(form)
        next.push(src)
      }
    }
    frontier = next
  }
  return upstream.length > 0 ? upstream : [...forms.values()]
}
