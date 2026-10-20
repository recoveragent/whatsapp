import type { Message } from '@/types';

/** Keep the provider's acceptance result alongside the existing template snapshot. */
export function withMetaAcceptance(
  payload: Record<string, unknown> | null,
  status?: string | null
): Record<string, unknown> | null {
  return status ? { ...payload, meta_message_status: status } : payload;
}

export function hasReportedDeliveryHold(
  message: Pick<Message, 'status' | 'content_payload'>
) {
  return (
    message.status === 'sent' &&
    message.content_payload?.meta_message_status ===
      'held_for_quality_assessment'
  );
}
