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

const WEBHOOK_OPTIONS: TemplateVariableOption[] = [
  {
    label: 'Webhook field',
    token: '{{ trigger.field_name }}',
    type: 'text',
  },
]

export function templateVariableGroupsForFlow(
  triggerType?: FlowTriggerType,
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
    triggerOptions.push(...WEBHOOK_OPTIONS)
  }

  if (triggerOptions.length > 0) {
    groups.push({
      id: 'trigger',
      label: 'Trigger attributes',
      options: triggerOptions,
    })
  }

  return groups
}

export function templateVariableGroupsForAutomation(
  triggerType?: string,
): TemplateVariableGroup[] {
  const groups: TemplateVariableGroup[] = [
    { id: 'contact', label: 'User attributes', options: CONTACT_OPTIONS },
  ]

  const triggerOptions: TemplateVariableOption[] = []
  if (triggerType?.startsWith('shopify_')) {
    triggerOptions.push(...SHOPIFY_OPTIONS)
  }
  if (triggerType === 'webhook_received') {
    triggerOptions.push(...WEBHOOK_OPTIONS)
  }

  if (triggerOptions.length > 0) {
    groups.push({
      id: 'trigger',
      label: 'Trigger attributes',
      options: triggerOptions,
    })
  }

  return groups
}
