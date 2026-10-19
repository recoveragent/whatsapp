import { normalizeTemplateButtons } from '@/lib/flows/template-buttons';
import { buttonCtaPurpose } from '@/lib/whatsapp/template-cta';

export function paymentTemplateError(
  buttons: unknown,
  variables: Record<string, string>,
  origins: string[]
): string | null {
  for (const [index, button] of normalizeTemplateButtons(buttons).entries()) {
    if (button.type !== 'URL') continue;
    const mapping = variables[`button_${index}`] ?? '';
    if (
      buttonCtaPurpose(button) !== 'payment' &&
      !/vars\.payment_(url|url_suffix)\b/.test(mapping)
    )
      continue;
    if (!origins.some((origin) => button.url === `${origin}/{{1}}`))
      return `The "${button.text}" button uses ${button.url}. Choose an approved payment template with ${origins.map((origin) => `${origin}/{{1}}`).join(' or ')}. WhatsApp keeps the template's URL domain fixed.`;
  }
  return null;
}

export function paymentOrigins(
  provider: string,
  environment?: string
): string[] {
  if (provider !== 'cashfree') return ['https://rzp.io'];
  if (environment === 'sandbox') return ['https://payments-test.cashfree.com'];
  if (environment === 'production') return ['https://payments.cashfree.com'];
  return [
    'https://payments.cashfree.com',
    'https://payments-test.cashfree.com',
  ];
}
