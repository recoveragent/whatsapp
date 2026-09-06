export const RECOVER_AGENT_DASHBOARD_ORIGIN =
  "https://dashboard.recoveragent.ai";

export const RECOVER_AGENT_EMBED_DEV_ORIGIN = "http://localhost:5173";

export const RECOVER_AGENT_EMBED_MESSAGE_TYPE = "recoveragent:wa-embed";

export const RECOVER_AGENT_EMBED_PARENT_ORIGINS = [
  RECOVER_AGENT_DASHBOARD_ORIGIN,
  RECOVER_AGENT_EMBED_DEV_ORIGIN,
] as const;

export type RecoverAgentEmbedMessage =
  | { type: typeof RECOVER_AGENT_EMBED_MESSAGE_TYPE; action: "close" }
  | {
      type: typeof RECOVER_AGENT_EMBED_MESSAGE_TYPE;
      action: "open";
      phone: string;
    }
  | {
      type: typeof RECOVER_AGENT_EMBED_MESSAGE_TYPE;
      action: "conversation-changed";
      phone: string;
    };

export function isRecoverAgentEmbedParentOrigin(origin: string): boolean {
  return (RECOVER_AGENT_EMBED_PARENT_ORIGINS as readonly string[]).includes(
    origin,
  );
}

export function isRecoverAgentEmbedMessage(
  data: unknown,
): data is RecoverAgentEmbedMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  if (msg.type !== RECOVER_AGENT_EMBED_MESSAGE_TYPE) return false;
  if (msg.action === "close") return true;
  if (msg.action === "open") return typeof msg.phone === "string";
  return msg.action === "conversation-changed" && typeof msg.phone === "string";
}

function postToRecoverAgentParent(message: RecoverAgentEmbedMessage): void {
  if (typeof window === "undefined" || window.parent === window) return;

  for (const origin of RECOVER_AGENT_EMBED_PARENT_ORIGINS) {
    window.parent.postMessage(message, origin);
  }
}

/** Tell the Recover Agent dashboard to close the WhatsApp iframe sidebar. */
export function notifyRecoverAgentEmbedClose(): void {
  postToRecoverAgentParent({
    type: RECOVER_AGENT_EMBED_MESSAGE_TYPE,
    action: "close",
  });
}

/** Optional: tell the dashboard which customer chat is active in the iframe. */
export function notifyRecoverAgentConversationChanged(phone: string): void {
  postToRecoverAgentParent({
    type: RECOVER_AGENT_EMBED_MESSAGE_TYPE,
    action: "conversation-changed",
    phone,
  });
}
