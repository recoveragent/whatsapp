/**
 * Outbound POST for the flow `send_webhook` / `http_fetch` nodes.
 *
 * The URL, headers and body are account-controlled and the server makes
 * the request, so this mirrors the automations send_webhook guard: refuse
 * private / internal destinations, never follow redirects, and bound the
 * request time (see lib/webhooks/ssrf.ts).
 */

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { interpolateTemplateString } from './template-interpolate'

export const FLOW_WEBHOOK_TIMEOUT_MS = 10_000

export interface FlowWebhookConfig {
  url: string
  headers?: Record<string, string>
  body_template?: string
}

export async function sendFlowWebhook(
  cfg: FlowWebhookConfig,
  vars: Record<string, unknown>,
  contactId: string | null,
  messageText?: string,
): Promise<number> {
  if (!cfg.url?.trim()) throw new Error('url required')

  // Variables in the URL are URI-encoded so a value can't break out of
  // its query parameter or path segment.
  const url = interpolateTemplateString(
    cfg.url.trim(),
    vars,
    messageText,
    encodeURIComponent,
  )
  if (!(await isDeliverableUrl(url))) {
    throw new Error('webhook destination not allowed')
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  for (const [name, value] of Object.entries(cfg.headers ?? {})) {
    if (!name.trim()) continue
    headers[name.trim()] = interpolateTemplateString(value ?? '', vars, messageText)
  }

  const body = cfg.body_template?.trim()
    ? interpolateTemplateString(cfg.body_template, vars, messageText)
    : JSON.stringify({ vars, contact_id: contactId })

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(FLOW_WEBHOOK_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`webhook returned ${res.status}`)
  return res.status
}
