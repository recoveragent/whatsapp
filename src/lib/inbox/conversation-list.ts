import type { Conversation, ConversationStatus } from '@/types';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export type InboxFilter = ConversationStatus | 'all' | 'unread';

export type InboxSortOrder = 'newest' | 'oldest';

type InboxListConversation = {
  id: string;
  status: ConversationStatus;
  unread_count?: number;
  last_message_at?: string | null;
  updated_at?: string | null;
  contact?: { name?: string | null; phone?: string | null } | null;
  last_message_text?: string | null;
};

/** Latest customer/agent message or status/assignment change — drives sidebar order. */
export function getInboxActivityAt(conv: {
  last_message_at?: string | null;
  updated_at?: string | null;
}): string | null {
  const msg = conv.last_message_at
    ? Date.parse(conv.last_message_at)
    : Number.NaN;
  const updated = conv.updated_at ? Date.parse(conv.updated_at) : Number.NaN;
  const msgValid = Number.isFinite(msg);
  const updatedValid = Number.isFinite(updated);

  if (msgValid && updatedValid) {
    return msg >= updated ? conv.last_message_at! : conv.updated_at!;
  }
  if (msgValid) return conv.last_message_at!;
  if (updatedValid) return conv.updated_at!;
  return null;
}

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

/** Sidebar list after search + status filter (preserves input order). */
export function filterInboxConversations<T extends InboxListConversation>(
  conversations: T[],
  filter: InboxFilter,
  search = '',
): T[] {
  let result = conversations.filter(shouldShowInInboxList);
  const q = search.trim();

  // Search spans all statuses — Shopify outbound threads start closed
  // and agents expect search to find them without switching filters.
  if (q) {
    return result.filter((c) => matchesInboxSearch(c, q));
  }

  if (filter === 'unread') {
    result = result.filter((c) => (c.unread_count ?? 0) > 0);
  } else if (filter !== 'all') {
    result = result.filter((c) => c.status === filter);
  }

  return result;
}

/** Sort sidebar rows by most recent inbox activity (message or status change). */
export function sortInboxConversations<T extends InboxListConversation>(
  conversations: T[],
  sort: InboxSortOrder,
): T[] {
  const sorted = [...conversations];
  sorted.sort((a, b) => {
    const aAt = getInboxActivityAt(a);
    const bAt = getInboxActivityAt(b);
    const aTime = aAt ? new Date(aAt).getTime() : 0;
    const bTime = bAt ? new Date(bAt).getTime() : 0;
    return sort === 'newest' ? bTime - aTime : aTime - bTime;
  });
  return sorted;
}

/**
 * Pick the next thread to open after closing the current one — prefer the
 * row below in the sidebar, then the row above, else none.
 */
export function getNextInboxConversation<T extends InboxListConversation>(
  conversations: T[],
  currentId: string,
  filter: InboxFilter,
  search = '',
  sort: InboxSortOrder = 'newest',
): T | null {
  const filtered = sortInboxConversations(
    filterInboxConversations(conversations, filter, search),
    sort,
  );
  const idx = filtered.findIndex((c) => c.id === currentId);

  if (idx === -1) {
    return filtered.find((c) => c.id !== currentId) ?? null;
  }

  if (filtered[idx + 1]) {
    return filtered[idx + 1];
  }

  if (idx > 0) {
    return filtered[idx - 1];
  }

  return null;
}
