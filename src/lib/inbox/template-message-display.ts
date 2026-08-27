import { normalizeTemplateButtons } from '@/lib/flows/template-buttons'
import type { Message, MessageTemplate, TemplateButton } from '@/types'

/** Resolve a template URL button href for display / storage. */
export function resolveUrlButtonHref(
  url: string,
  suffix?: string,
): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const resolved = trimmed.replace(/\{\{1\}\}/g, suffix?.trim() ?? '')
  if (/\{\{\d+\}\}/.test(resolved)) return null

  try {
    const parsed = new URL(resolved)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function resolveSnapshotButtonUrls(
  buttons: TemplateButton[],
  buttonParams?: Record<number, string>,
): TemplateButton[] {
  return buttons.map((button, index) => {
    if (button.type !== 'URL') return button
    const href = resolveUrlButtonHref(button.url, buttonParams?.[index])
    if (!href) return button
    return { ...button, url: href }
  })
}

/** Snapshot stored on `messages.content_payload.template_display`. */
export interface TemplateMessageSnapshot {
  header_type?: MessageTemplate['header_type'] | null
  header_content?: string | null
  header_media_url?: string | null
  footer_text?: string | null
  buttons?: TemplateButton[]
}

const MEDIA_HEADER_TYPES = new Set(['image', 'video', 'document'])

export function isMediaHeaderType(
  value: unknown,
): value is 'image' | 'video' | 'document' {
  return typeof value === 'string' && MEDIA_HEADER_TYPES.has(value)
}

export function buildTemplateMessageSnapshot(
  template: MessageTemplate,
  overrides?: {
    headerMediaUrl?: string
    headerText?: string
    buttonParams?: Record<number, string>
  },
): TemplateMessageSnapshot {
  const snapshot: TemplateMessageSnapshot = {
    header_type: template.header_type ?? null,
    header_content: template.header_content ?? null,
    header_media_url:
      overrides?.headerMediaUrl?.trim() ||
      template.header_media_url?.trim() ||
      null,
    footer_text: template.footer_text ?? null,
    buttons: resolveSnapshotButtonUrls(
      normalizeTemplateButtons(template.buttons),
      overrides?.buttonParams,
    ),
  }

  if (overrides?.headerText?.trim() && snapshot.header_type === 'text') {
    snapshot.header_content = overrides.headerText.trim()
  }

  return snapshot
}

function snapshotFromPayload(
  payload: Record<string, unknown> | null | undefined,
): TemplateMessageSnapshot | null {
  const raw = payload?.template_display
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  return {
    header_type:
      typeof row.header_type === 'string'
        ? (row.header_type as MessageTemplate['header_type'])
        : null,
    header_content:
      typeof row.header_content === 'string' ? row.header_content : null,
    header_media_url:
      typeof row.header_media_url === 'string' ? row.header_media_url : null,
    footer_text: typeof row.footer_text === 'string' ? row.footer_text : null,
    buttons: normalizeTemplateButtons(row.buttons),
  }
}

export function resolveTemplateMessageDisplay(
  message: Message,
  template?: MessageTemplate | null,
): TemplateMessageSnapshot | null {
  const fromPayload = snapshotFromPayload(message.content_payload ?? null)
  if (fromPayload) return fromPayload

  if (template) {
    return buildTemplateMessageSnapshot(template)
  }

  return null
}

export function templateDisplayPayload(
  snapshot: TemplateMessageSnapshot,
): Record<string, unknown> {
  return { template_display: snapshot }
}
