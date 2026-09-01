import type { Conversation } from '@/types';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/** Only conversations with at least one message belong in the inbox sidebar. */
export function shouldShowInInboxList(conv: {
  last_message_at?: string | null;
}): boolean {
  return conv.last_message_at != null;
}

type InboxSearchConversation = {
  contact?: { name?: string | null; phone?: string | null } | null;
  last_message_text?: string | null;
};

/** Match inbox sidebar search — name, phone (incl. digit-only), last message. */
export function matchesInboxSearch(
  conv: InboxSearchConversation,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const name = conv.contact?.name?.toLowerCase() ?? '';
  const phone = conv.contact?.phone?.toLowerCase() ?? '';
  const lastMsg = conv.last_message_text?.toLowerCase() ?? '';
  const qDigits = normalizePhone(q);
  const phoneDigits = normalizePhone(phone);

  return (
    name.includes(q) ||
    phone.includes(q) ||
    lastMsg.includes(q) ||
    (qDigits.length >= 4 && phoneDigits.includes(qDigits))
  );
}

/** Open threads that appear in the inbox's default "Open" filter. */
export function isOpenInboxConversation(conv: {
  status: Conversation['status'];
  last_message_at?: string | null;
}): boolean {
  return conv.status === 'open' && shouldShowInInboxList(conv);
}
