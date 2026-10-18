import type { TemplateButton } from '@/types';

export const CTA_PURPOSES = [
  'payment',
  'tracking',
  'checkout',
  'order_status',
  'custom',
] as const;
export type CtaPurpose = (typeof CTA_PURPOSES)[number];
export const CTA_LABELS: Record<CtaPurpose, string> = {
  payment: 'Payment request or reminder',
  tracking: 'Courier tracking',
  checkout: 'Checkout recovery',
  order_status: 'Order details',
  custom: 'Custom',
};
export const CTA_VARIABLES: Record<Exclude<CtaPurpose, 'custom'>, string> = {
  payment: '{{ vars.payment_url_suffix }}',
  tracking: '{{ vars.tracking_url_redirect_suffix }}',
  checkout: '{{ vars.checkout_url_suffix }}',
  order_status: '{{ vars.order_status_url_suffix }}',
};
export function isCtaPurpose(value: unknown): value is CtaPurpose {
  return CTA_PURPOSES.includes(value as CtaPurpose);
}

function httpsOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error('Enter an HTTPS website address without credentials.');
  return parsed.origin;
}

export function suggestedCta(
  purpose: Exclude<CtaPurpose, 'custom'>,
  siteUrl: string,
  storeUrl = ''
): Extract<TemplateButton, { type: 'URL' }> {
  const label = {
    payment: 'Pay now',
    tracking: 'Track order',
    checkout: 'Complete purchase',
    order_status: 'View order',
  }[purpose];
  const base =
    purpose === 'payment'
      ? 'https://rzp.io/'
      : purpose === 'tracking'
        ? `${httpsOrigin(siteUrl)}/t/`
        : `${httpsOrigin(storeUrl)}/`;
  const example = {
    payment: 'rzp/example-payment',
    tracking: 'example_tracking_token_123456',
    checkout: 'checkouts/example-checkout',
    order_status: 'orders/example-order',
  }[purpose];
  return {
    type: 'URL',
    text: label,
    url: `${base}{{1}}`,
    example: `${base}${example}`,
    url_purpose: purpose,
  };
}

export function buttonCtaPurpose(button: TemplateButton): CtaPurpose {
  if (button.type !== 'URL') return 'custom';
  if (isCtaPurpose(button.url_purpose)) return button.url_purpose;
  // Recognize safe legacy payment URLs. Do not guess the purpose of a store URL.
  if (button.url === 'https://rzp.io/{{1}}') return 'payment';
  return 'custom';
}

/** Fill only empty slots. Explicit mappings always belong to the user. */
export function seedCtaMappings(
  buttons: TemplateButton[],
  variables: Record<string, string>
): Record<string, string> {
  const next = { ...variables };
  buttons.forEach((button, index) => {
    if (
      button.type !== 'URL' ||
      !button.url.includes('{{1}}') ||
      next[`button_${index}`]?.trim()
    )
      return;
    const purpose = buttonCtaPurpose(button);
    if (purpose !== 'custom') next[`button_${index}`] = CTA_VARIABLES[purpose];
  });
  return next;
}

/** Meta does not retain our local purpose metadata. Preserve it only for an unchanged button. */
export function preserveCtaPurposes(
  incoming: TemplateButton[],
  existing: TemplateButton[]
): TemplateButton[] {
  return incoming.map((button) => {
    if (button.type !== 'URL') return button;
    const old = existing.find(
      (b) => b.type === 'URL' && b.url === button.url && b.text === button.text
    );
    return old?.type === 'URL' && isCtaPurpose(old.url_purpose)
      ? { ...button, url_purpose: old.url_purpose }
      : button;
  });
}
