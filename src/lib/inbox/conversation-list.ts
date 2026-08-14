import type { Conversation } from '@/types';

/** Only conversations with at least one message belong in the inbox sidebar. */
export function shouldShowInInboxList(
  conv: Pick<Conversation, 'last_message_at'>,
): boolean {
  return conv.last_message_at != null;
}
