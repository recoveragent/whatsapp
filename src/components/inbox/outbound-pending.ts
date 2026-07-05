import type { Message } from "@/types";

export const OUTBOUND_PENDING_TOAST =
  "Wait for your message to finish sending before leaving this chat.";

/** True while a composer upload/draft is in progress or an outbound bubble is still sending. */
export function hasOutboundInFlight(
  messages: Message[],
  composerPending: boolean,
): boolean {
  if (composerPending) return true;
  return messages.some(
    (m) =>
      (m.sender_type === "agent" || m.sender_type === "bot") &&
      m.status === "sending",
  );
}
