import {
  extractByPath,
  flattenPayloadKeys,
  normalizePayloadPath,
} from '@/lib/automations/webhook-payload'
import {
  isShopifyOrderFlowTrigger,
  type FlowTriggerType,
} from './trigger-types'

export type TemplateVariableType = 'text' | 'boolean' | 'array'

export interface TemplateVariableOption {
  label: string
  token: string
  type?: TemplateVariableType
}

export interface TemplateVariableGroup {
  id: string
  label: string
  options: TemplateVariableOption[]
}

const CONTACT_OPTIONS: TemplateVariableOption[] = [
  { label: 'Full name', token: '{{ vars.name }}', type: 'text' },
  { label: 'First name', token: '{{ vars.first_name }}', type: 'text' },
  { label: 'Last name', token: '{{ vars.last_name }}', type: 'text' },
  { label: 'Phone number', token: '{{ vars.phone }}', type: 'text' },
  { label: 'Email', token: '{{ vars.email }}', type: 'text' },
  { label: 'Company', token: '{{ vars.company }}', type: 'text' },
]

const SHOPIFY_OPTIONS: TemplateVariableOption[] = [
  { label: 'Customer name', token: '{{ vars.customer_name }}', type: 'text' },
  { label: 'Order number', token: '{{ vars.order_number }}', type: 'text' },
  { label: 'Order total', token: '{{ vars.order_total }}', type: 'text' },
  { label: 'Order items', token: '{{ vars.order_items }}', type: 'text' },
  { label: 'Product image', token: '{{ vars.product_image }}', type: 'text' },
  { label: 'Shipping address', token: '{{ vars.shipping_address }}', type: 'text' },
  { label: 'Payment status', token: '{{ vars.payment_status }}', type: 'text' },
  { label: 'Fulfillment status', token: '{{ vars.fulfillment_status }}', type: 'text' },
  { label: 'Tracking number', token: '{{ vars.tracking_number }}', type: 'text' },
  { label: 'Tracking URL', token: '{{ vars.tracking_url }}', type: 'text' },
  { label: 'Checkout URL', token: '{{ vars.checkout_url }}', type: 'text' },
  { label: 'Shop name', token: '{{ vars.shop_name }}', type: 'text' },
]

const MESSAGE_OPTIONS: TemplateVariableOption[] = [
  { label: 'Last message', token: '{{ message.text }}', type: 'text' },
]

const WEBHOOK_FALLBACK_OPTIONS: TemplateVariableOption[] = [
  {
    label: 'Webhook field (any path)',
    token: '{{ trigger.field_name }}',
    type: 'text',
  },
]

/** Presets for {{ vars.x | "fallback" }} — shown in every flow/automation form. */
const FALLBACK_OPTIONS: TemplateVariableOption[] = [
  {
    label: 'Name or "there"',
    token: '{{ vars.name | "there" }}',
    type: 'text',
  },
  {
    label: 'First name or "there"',
    token: '{{ vars.first_name | "there" }}',
    type: 'text',
  },
  {
    label: 'Custom field with fallback',
    token: '{{ vars.field | "fallback text" }}',
    type: 'text',
  },
]

/** Build picker options from webhook trigger config (mappings + last payload). */
export function webhookTemplateVariableOptions(
  config?: Record<string, unknown> | null,
): TemplateVariableOption[] {
  const options: TemplateVariableOption[] = []
  const seenTokens = new Set<string>()
  const mappedPaths = new Set<string>()

  const add = (label: string, token: string) => {
    if (seenTokens.has(token)) return
    seenTokens.add(token)
    options.push({ label, token, type: 'text' })
  }

  const mappings =
    config?.variable_mappings && typeof config.variable_mappings === 'object'
      ? (config.variable_mappings as Record<string, string>)
      : {}

  for (const [varName, path] of Object.entries(mappings).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!varName.trim()) continue
    const normalized = normalizePayloadPath(path)
    if (normalized) mappedPaths.add(normalized)
    const trimmedPath = path.trim()
    const label = trimmedPath ? `${varName} (${trimmedPath})` : varName
    add(label, `{{ vars.${varName} }}`)
  }

  const payload = config?.last_received_payload
  if (payload) {
    for (const path of flattenPayloadKeys(payload).sort()) {
      if (mappedPaths.has(path)) continue
      const val = extractByPath(payload, path)
      if (val === null || val === undefined || typeof val === 'object') continue
      add(path, `{{ trigger.${path} }}`)
    }
  }

  if (options.length === 0) {
    return [...WEBHOOK_FALLBACK_OPTIONS]
  }

  for (const fallback of WEBHOOK_FALLBACK_OPTIONS) {
    add(fallback.label, fallback.token)
  }

  return options
}

const GOOGLE_SHEET_OPTIONS: TemplateVariableOption[] = [
  { label: 'Sheet phone', token: '{{ vars.phone }}', type: 'text' },
  { label: 'Sheet name', token: '{{ vars.name }}', type: 'text' },
  { label: 'Sheet email', token: '{{ vars.email }}', type: 'text' },
  { label: 'Sheet row number', token: '{{ vars.sheet_row }}', type: 'text' },
  { label: 'Sheet source label', token: '{{ vars.sheet_source }}', type: 'text' },
  {
    label: 'Sheet column (by header)',
    token: '{{ vars.ColumnName }}',
    type: 'text',
  },
]

export function templateVariableGroupsForFlow(
  triggerType?: FlowTriggerType,
  triggerConfig?: Record<string, unknown>,
): TemplateVariableGroup[] {
  const groups: TemplateVariableGroup[] = [
    { id: 'contact', label: 'User attributes', options: CONTACT_OPTIONS },
  ]

  const triggerOptions: TemplateVariableOption[] = []

  if (triggerType && isShopifyOrderFlowTrigger(triggerType)) {
    triggerOptions.push(...SHOPIFY_OPTIONS)
  }
  if (
    triggerType === 'new_message_received' ||
    triggerType === 'keyword' ||
    triggerType === 'first_inbound_message'
  ) {
    triggerOptions.push(...MESSAGE_OPTIONS)
  }
  if (triggerType === 'webhook_received') {
    triggerOptions.push(...webhookTemplateVariableOptions(triggerConfig))
  }
  if (triggerType === 'google_sheet_row') {
    triggerOptions.push(...GOOGLE_SHEET_OPTIONS)
  }

  if (triggerOptions.length > 0) {
    groups.push({
      id: 'trigger',
      label: 'Trigger attributes',
      options: triggerOptions,
    })
  }

  groups.push({
    id: 'fallback',
    label: 'Fallback (when empty)',
    options: FALLBACK_OPTIONS,
  })

  return groups
}

export function templateVariableGroupsForAutomation(
  triggerType?: string,
  triggerConfig?: Record<string, unknown>,
): TemplateVariableGroup[] {
  const groups: TemplateVariableGroup[] = [
    { id: 'contact', label: 'User attributes', options: CONTACT_OPTIONS },
  ]

  const triggerOptions: TemplateVariableOption[] = []
  if (triggerType?.startsWith('shopify_')) {
    triggerOptions.push(...SHOPIFY_OPTIONS)
  }
  if (triggerType === 'webhook_received') {
    triggerOptions.push(...webhookTemplateVariableOptions(triggerConfig))
  }
  if (triggerType === 'google_sheet_row') {
    triggerOptions.push(...GOOGLE_SHEET_OPTIONS)
  }

  if (triggerOptions.length > 0) {
    groups.push({
      id: 'trigger',
      label: 'Trigger attributes',
      options: triggerOptions,
    })
  }

  groups.push({
    id: 'fallback',
    label: 'Fallback (when empty)',
    options: FALLBACK_OPTIONS,
  })

  return groups
}
