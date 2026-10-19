import type { SendTemplateNodeConfig } from './types';

export interface CollectPaymentNodeConfig {
  provider: 'razorpay' | 'cashfree';
  currency: 'INR';
  /** Rupees, converted to paise on the server. */
  amount: number;
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
  const paise = Number(c.amount) * 100;
  if (
    typeof c.amount !== 'number' ||
    !Number.isSafeInteger(Math.round(paise)) ||
    c.amount < 1 ||
    Math.abs(paise - Math.round(paise)) > 0.00001
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
