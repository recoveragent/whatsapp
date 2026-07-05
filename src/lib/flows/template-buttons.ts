import type { MessageTemplate, TemplateButton } from '@/types'

export interface TemplateQuickReplyButton {
  reply_id: string
  title: string
  next_node_key: string
}

function normalizeButtonType(type: unknown): string {
  return String(type ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_')
}

/** Coerce JSONB / legacy rows into a buttons array. */
export function normalizeTemplateButtons(
  raw: MessageTemplate['buttons'] | unknown,
): TemplateButton[] {
  if (!raw) return []
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const out: TemplateButton[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = normalizeButtonType(row.type)
    const text =
      (typeof row.text === 'string' ? row.text : typeof row.label === 'string' ? row.label : '')
        .trim()
    if (!text) continue
    if (
      type === 'QUICK_REPLY' ||
      type === 'QUICKREPLY' ||
      type === 'QUICK REPLY'
    ) {
      out.push({ type: 'QUICK_REPLY', text })
    } else if (type === 'URL') {
      out.push({
        type: 'URL',
        text,
        url: typeof row.url === 'string' ? row.url : '',
        example: typeof row.example === 'string' ? row.example : undefined,
      })
    } else if (type === 'PHONE_NUMBER' || type === 'PHONE') {
      out.push({
        type: 'PHONE_NUMBER',
        text,
        phone_number: typeof row.phone_number === 'string' ? row.phone_number : '',
      })
    } else if (type === 'COPY_CODE') {
      out.push({
        type: 'COPY_CODE',
        text,
        example: typeof row.example === 'string' ? row.example : '',
      })
    }
  }
  return out
}

export function quickReplyButtonsFromTemplate(
  template: Pick<MessageTemplate, 'buttons'> | { buttons?: unknown },
): Array<{ reply_id: string; title: string }> {
  return normalizeTemplateButtons(template.buttons)
    .filter((b): b is Extract<TemplateButton, { type: 'QUICK_REPLY' }> => b.type === 'QUICK_REPLY')
    .map((b) => ({ reply_id: b.text, title: b.text }))
}

export function syncTemplateButtonConfig(
  existing: TemplateQuickReplyButton[] | undefined,
  template: Pick<MessageTemplate, 'buttons'> | { buttons?: unknown },
): TemplateQuickReplyButton[] {
  const quick = quickReplyButtonsFromTemplate(template)
  return quick.map((b) => {
    const prev = existing?.find(
      (e) => e.reply_id === b.reply_id || e.title === b.title,
    )
    return {
      reply_id: b.reply_id,
      title: b.title,
      next_node_key: prev?.next_node_key ?? '',
    }
  })
}

export function templateConfigHasQuickReplies(cfg: {
  buttons?: TemplateQuickReplyButton[]
}): boolean {
  return (cfg.buttons?.length ?? 0) > 0
}

export function quickReplyIdsKey(
  template: Pick<MessageTemplate, 'buttons'> | { buttons?: unknown },
): string {
  return quickReplyButtonsFromTemplate(template)
    .map((b) => b.reply_id)
    .join('\0')
}

export function configQuickReplyIdsKey(
  buttons: TemplateQuickReplyButton[] | undefined,
): string {
  return (buttons ?? []).map((b) => b.reply_id).join('\0')
}
