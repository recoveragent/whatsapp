import type { WebhookTriggerConfig } from '@/types'
import { generateWebhookToken } from './webhook-token'

export function defaultWebhookTriggerConfig(): WebhookTriggerConfig {
  return {
    webhook_token: generateWebhookToken(),
    phone_path: 'phone',
    name_path: 'name',
    email_path: 'email',
    variable_mappings: {},
  }
}

/** Ensure webhook trigger config has a token and default paths. */
export function ensureWebhookTriggerConfig(
  config: Record<string, unknown> | null | undefined,
): WebhookTriggerConfig {
  const base = defaultWebhookTriggerConfig()
  const c = (config ?? {}) as Partial<WebhookTriggerConfig>
  return {
    webhook_token:
      typeof c.webhook_token === 'string' && c.webhook_token.trim()
        ? c.webhook_token
        : base.webhook_token,
    phone_path:
      typeof c.phone_path === 'string' && c.phone_path.trim()
        ? c.phone_path
        : base.phone_path,
    name_path: typeof c.name_path === 'string' ? c.name_path : base.name_path,
    email_path: typeof c.email_path === 'string' ? c.email_path : base.email_path,
    variable_mappings:
      c.variable_mappings && typeof c.variable_mappings === 'object'
        ? (c.variable_mappings as Record<string, string>)
        : {},
    last_received_payload: c.last_received_payload,
    last_received_at: c.last_received_at,
  }
}
