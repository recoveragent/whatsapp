import type { Notification } from '@/types';

export function alertCode(alert: Notification): string | null {
  return alert.body?.match(/\[(\d{1,7})\]/)?.[1] ?? null;
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

/**
 * critical: sending is blocked for the whole account.
 * action: something in our setup (template, media, params) needs fixing.
 * recipient: Meta or the customer's side; usually nothing to fix.
 * temporary: rate limits and Meta outages; retry later.
 */
export type AlertSeverity = 'critical' | 'action' | 'temporary' | 'recipient';

export interface AlertGroupInfo {
  title: string;
  hint: string;
  severity: AlertSeverity;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, action: 1, temporary: 2, recipient: 3 };

const t = (title: string, hint: string, severity: AlertSeverity): AlertGroupInfo => ({ title, hint, severity });

/** Plain-language meaning of the Meta Cloud API error codes we see most. */
const META_CODES: Record<string, AlertGroupInfo> = {
  '131042': t('Meta payment issue', 'Fix the WhatsApp payment method in Meta Business Manager.', 'critical'),
  '131031': t('WhatsApp account locked', 'Meta locked the business account. Check Business Support.', 'critical'),
  '368': t('Temporarily blocked for policy', 'Meta restricted sending. Review account quality in WhatsApp Manager.', 'critical'),
  '190': t('Access token expired', 'Reconnect WhatsApp in Settings.', 'critical'),
  '133010': t('Phone number not registered', 'Re-register the business number in Settings.', 'critical'),
  '132000': t('Template variables mismatch', 'The number of variables sent does not match the template.', 'action'),
  '132001': t('Template not found', 'The template was deleted or its name/language is wrong.', 'action'),
  '132005': t('Template text too long', 'Shorten the variable values used in this template.', 'action'),
  '132007': t('Template policy violation', 'Meta rejected the template content. Edit and resubmit it.', 'action'),
  '132012': t('Template variable format wrong', 'A variable value has the wrong format.', 'action'),
  '132015': t('Template paused', 'Meta paused this template for low quality.', 'action'),
  '132016': t('Template disabled', 'Meta disabled this template. Create a new one.', 'action'),
  '131008': t('Required parameter missing', 'A message field was left empty.', 'action'),
  '131009': t('Invalid parameter value', 'A message field has a value Meta does not accept.', 'action'),
  '131051': t('Unsupported message type', 'This message type cannot be sent on WhatsApp.', 'action'),
  '131052': t('Media download failed', 'The customer’s media could not be downloaded.', 'action'),
  '131053': t('Media upload failed', 'Check the file type and size of the attachment.', 'action'),
  '130429': t('Rate limit reached', 'Too many messages too fast. They can be retried later.', 'temporary'),
  '131056': t('Too many messages to one contact', 'Wait before messaging this contact again.', 'temporary'),
  '131048': t('Spam rate limit', 'Meta limited sending due to low quality. Slow down broadcasts.', 'temporary'),
  '131000': t('Meta error, try again', 'Something went wrong on Meta’s side.', 'temporary'),
  '131016': t('WhatsApp service unavailable', 'Meta is having issues. Retry later.', 'temporary'),
  '131047': t('24-hour window closed', 'Send an approved template to restart the chat.', 'recipient'),
  '131026': t('Recipient can’t receive messages', 'The number may not be on WhatsApp or must accept new terms.', 'recipient'),
  '131049': t('Not delivered by Meta (marketing limit)', 'Meta limits how many marketing messages each person receives.', 'recipient'),
  '131050': t('Contact stopped marketing messages', 'This person opted out of marketing from your business.', 'recipient'),
  '130472': t('Recipient in Meta experiment', 'Meta held back this marketing message.', 'recipient'),
  '131021': t('Recipient is the sender', 'You cannot message your own business number.', 'recipient'),
};

const GUIDANCE = / (Check WhatsApp billing in Meta Business Manager, including country, currency and payment method|Open the chat to review the failed message before retrying)\.$/;

/** Meta's own wording after the `[code]`, used for codes we have no label for. */
export function metaReason(alert: Notification): string | null {
  const body = alert.body ?? '';
  const match = body.match(/\[\d{1,7}\]\s*([^;]*)/);
  const reason = (match ? match[1] : body.replace(/^[^:]*:\s*/, '')).replace(GUIDANCE, '').trim();
  return reason && reason !== 'No error details were returned.' ? reason : null;
}

export function describeAlertGroup(key: string, alerts: Notification[]): AlertGroupInfo {
  if (key === 'connection') return t(alerts[0]?.title || 'WhatsApp disconnected', 'Reconnect WhatsApp in Settings.', 'critical');
  const known = META_CODES[key];
  if (known) return known;
  const reason = alerts[0] ? metaReason(alerts[0]) : null;
  if (key === 'other') return t(reason ?? 'Message failed (no error code)', 'Open the chat to review the failed message.', 'action');
  return t(reason ? `${reason} (${key})` : `Message failed (${key})`, 'Open the chat to review the failed message.', 'action');
}

export interface DeliveryAlertGroup extends AlertGroupInfo {
  key: string;
  alerts: Notification[];
  conversations: number;
  latestAt: string;
}

export function groupDeliveryAlerts(alerts: Notification[]): DeliveryAlertGroup[] {
  const groups = new Map<string, Notification[]>();
  for (const alert of alerts) {
    const key = alert.type === 'whatsapp_disconnected' ? 'connection' : alertCode(alert) ?? 'other';
    groups.set(key, [...(groups.get(key) ?? []), alert]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      alerts: items,
      ...describeAlertGroup(key, items),
      conversations: new Set(items.map((item) => item.conversation_id).filter(Boolean)).size,
      latestAt: items.reduce((latest, item) => (item.created_at > latest ? item.created_at : latest), items[0].created_at),
    }))
    // Newest activity first; severity only breaks ties.
    .sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** True when this notification belongs to the group key used in links (`?code=`). */
export function alertInGroup(alert: Notification, key: string): boolean {
  if (key === 'connection') return alert.type === 'whatsapp_disconnected';
  if (alert.type !== 'message_failed') return false;
  return (alertCode(alert) ?? 'other') === key;
}

/** Contact name the database trigger puts before the first `:` of the body. */
export function alertContact(alert: Notification): string | null {
  const name = alert.body?.match(/^([^:[\n]{1,80}):/)?.[1]?.trim();
  return name || null;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
