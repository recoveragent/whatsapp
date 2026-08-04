/** How a brand's WhatsApp number is connected to the CRM. */
export type WhatsAppConnectMode = 'embedded_signup' | 'system_user_token';

export const WHATSAPP_CONNECT_MODES: WhatsAppConnectMode[] = [
  'embedded_signup',
  'system_user_token',
];

export const WHATSAPP_CONNECT_MODE_LABELS: Record<WhatsAppConnectMode, string> = {
  embedded_signup: 'Meta Embedded Signup',
  system_user_token: 'System user token (own portfolio)',
};

export function isWhatsAppConnectMode(value: unknown): value is WhatsAppConnectMode {
  return value === 'embedded_signup' || value === 'system_user_token';
}

export function normalizeWhatsAppConnectMode(
  value: unknown,
): WhatsAppConnectMode {
  return isWhatsAppConnectMode(value) ? value : 'embedded_signup';
}
