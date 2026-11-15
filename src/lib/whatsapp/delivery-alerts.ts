import type { Notification } from '@/types';

export function alertCode(alert: Notification): string | null {
  return alert.body?.match(/\[(\d{5,6})\]/)?.[1] ?? null;
}

/** Only use an HTTPS Meta Business link supplied in this notification. */
export function paymentIssueUrl(alert: Notification): string | null {
  if (alertCode(alert) !== '131042') return null;
  const candidates = alert.body?.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[.,;!?]+$/, ''));
      if (url.protocol === 'https:' && url.hostname === 'business.facebook.com' && !url.username && !url.password && !url.port) return url.href;
    } catch { /* Ignore malformed links. */ }
  }
  return null;
}

export function metaPaymentMessage(alert: Notification): string {
  const body = alert.body ?? '';
  const detail = body.split('[131042]')[1]?.trim() ?? body;
  return detail.replace(/ Check WhatsApp billing in Meta Business Manager, including country, currency and payment method\.$/, '')
    .replace(/https?:\/\/[^\s]+/gi, '[payment link]');
}

export function groupDeliveryAlerts(alerts: Notification[]) {
  const groups = new Map<string, Notification[]>();
  for (const alert of alerts) {
    const key = alert.type === 'whatsapp_disconnected' ? 'connection' : alertCode(alert) ?? 'other';
    groups.set(key, [...(groups.get(key) ?? []), alert]);
  }
  return [...groups.entries()].sort(([a], [b]) => Number(b === '131042' || b === 'connection') - Number(a === '131042' || a === 'connection'));
}
