import type { SendTemplateNodeConfig } from './types';

export interface CollectPaymentNodeConfig {
  provider: 'razorpay' | 'cashfree';
  /** Cashfree mobile checkout; omitted uses direct UPI for newly created links. */
  cashfree_checkout?: 'upi_intent' | 'hosted';
  currency: 'INR';
  /** Rupees, converted to paise on the server. Ignored for COD → prepaid. */
  amount: number;
  /**
   * COD → prepaid: charge the triggering Shopify order's outstanding balance and
   * mark that order paid once the gateway confirms payment.
   */
  shopify_cod_to_prepaid?: boolean;
  /** Tag added to the Shopify order after conversion. Empty adds no tag. */
  shopify_paid_tag?: string;
  description: string;
  expiry_hours: number;
  reminder_minutes: number;
  max_reminders: number;
  request_template: SendTemplateNodeConfig;
  reminder_template: SendTemplateNodeConfig;
  paid_next: string;
  expired_next: string;
  failed_next: string;
}

export const PAYMENT_BRANCHES = [
  { id: 'paid', field: 'paid_next', label: 'Payment received' },
  { id: 'expired', field: 'expired_next', label: 'Payment link expired' },
  { id: 'failed', field: 'failed_next', label: 'Payment failed' },
] as const;

export function paymentConfigErrors(
  c: Record<string, unknown>
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const add = (field: string, message: string) =>
    errors.push({ field, message });
  if (
    !['razorpay', 'cashfree'].includes(String(c.provider)) ||
    c.currency !== 'INR'
  )
    add('provider', 'Select Razorpay or Cashfree and INR.');
  if (
    c.provider === 'cashfree' &&
    c.cashfree_checkout !== undefined &&
    !['upi_intent', 'hosted'].includes(String(c.cashfree_checkout))
  )
    add('cashfree_checkout', 'Select direct UPI or hosted checkout.');
  const paise = Number(c.amount) * 100;
  if (
    c.shopify_paid_tag !== undefined &&
    (typeof c.shopify_paid_tag !== 'string' ||
      c.shopify_paid_tag.length > 40 ||
      c.shopify_paid_tag.includes(','))
  )
    add('shopify_paid_tag', 'Use a single tag of up to 40 characters.');
  if (
    c.shopify_cod_to_prepaid !== true &&
    (typeof c.amount !== 'number' ||
      !Number.isSafeInteger(Math.round(paise)) ||
      c.amount < 1 ||
      Math.abs(paise - Math.round(paise)) > 0.00001)
  )
    add(
      'amount',
      'Enter a fixed amount of at least ₹1 with at most two decimal places.'
    );
  if (
    typeof c.description !== 'string' ||
    !c.description.trim() ||
    c.description.length > 255
  )
    add('description', 'Enter a description of up to 255 characters.');
  if (
    typeof c.expiry_hours !== 'number' ||
    !Number.isFinite(c.expiry_hours) ||
    c.expiry_hours < 1 ||
    c.expiry_hours > 720
  )
    add('expiry_hours', 'Expiry must be between 1 and 720 hours.');
  if (
    !Number.isInteger(c.max_reminders) ||
    Number(c.max_reminders) < 0 ||
    Number(c.max_reminders) > 5
  )
    add('max_reminders', 'Choose between 0 and 5 reminders.');
  if (
    Number(c.max_reminders) > 0 &&
    (typeof c.reminder_minutes !== 'number' ||
      !Number.isInteger(c.reminder_minutes) ||
      c.reminder_minutes < 5 ||
      c.reminder_minutes >= Number(c.expiry_hours) * 60)
  )
    add(
      'reminder_minutes',
      'Reminder interval must be at least 5 minutes and shorter than the link lifetime.'
    );
  for (const field of [
    'request_template',
    ...(Number(c.max_reminders) > 0 ? ['reminder_template'] : []),
  ]) {
    const template = c[field] as SendTemplateNodeConfig | undefined;
    if (
      typeof template?.template_name !== 'string' ||
      !template.template_name.trim()
    )
      add(field, 'Select an approved WhatsApp template.');
    if (template?.buttons?.length)
      add(
        field,
        'Payment messages must use templates without quick-reply buttons. URL buttons are supported.'
      );
    if (
      template?.template_name &&
      !Object.values(template.variables ?? {}).some((v) =>
        /\{\{\s*vars\.payment_(url|url_suffix)\s*\}\}/.test(v)
      )
    )
      add(
        field,
        'Map a template field or URL button to the payment link variable.'
      );
  }
  return errors;
}

/** COD → prepaid needs a live, uncancelled order from the run's trigger. */
export const COD_TO_PREPAID_TRIGGERS = [
  'shopify_order_placed',
  'shopify_order_updated',
] as const;

export function supportsCodToPrepaid(triggerType: string | undefined): boolean {
  return (COD_TO_PREPAID_TRIGGERS as readonly string[]).includes(
    triggerType ?? ''
  );
}

export const DEFAULT_SHOPIFY_PAID_TAG = 'cod-to-prepaid';

export const PAYMENT_VARIABLE_GROUP = {
  id: 'payment',
  label: 'Collected payment',
  options: [
    { label: 'Payment link', token: '{{ vars.payment_url }}' },
    {
      label: 'Payment URL suffix (match the gateway template domain)',
      token: '{{ vars.payment_url_suffix }}',
    },
    { label: 'Amount (rupees)', token: '{{ vars.payment_amount }}' },
    { label: 'Currency', token: '{{ vars.payment_currency }}' },
    { label: 'Description', token: '{{ vars.payment_description }}' },
    { label: 'Payment status', token: '{{ vars.payment_collection_status }}' },
    { label: 'Payment reference', token: '{{ vars.payment_reference }}' },
  ],
};
