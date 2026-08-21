import type { Conversation } from '@/types';

/** Only conversations with at least one message belong in the inbox sidebar. */
export function shouldShowInInboxList(conv: {
  last_message_at?: string | null;
}): boolean {
  return conv.last_message_at != null;
}

/** Open threads that appear in the inbox's default "Open" filter. */
export function isOpenInboxConversation(conv: {
  status: Conversation['status'];
  last_message_at?: string | null;
}): boolean {
  return conv.status === 'open' && shouldShowInInboxList(conv);
}
