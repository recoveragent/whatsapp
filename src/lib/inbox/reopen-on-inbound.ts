/**
 * Whether an inbound customer message should reopen a closed/followup
 * conversation in the agent inbox.
 */
export function shouldReopenConversationOnInbound(args: {
  conversationStatus: string;
  suppressInboxReopen?: boolean;
}): boolean {
  if (args.suppressInboxReopen) return false;
  return (
    args.conversationStatus === "closed" ||
    args.conversationStatus === "followup"
  );
}

/**
 * Whether the webhook should call `reopenClosedConversation` after the
 * primary reopen branch did not fire. Suppressed when a flow closed the
 * conversation on the same inbound (e.g. template quick-reply → close).
 */
export function shouldAttemptSqlReopenOnInbound(args: {
  suppressInboxReopen?: boolean;
}): boolean {
  return !args.suppressInboxReopen;
}
