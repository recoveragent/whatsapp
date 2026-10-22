/**
 * Whether an inbound customer message should reopen a closed/followup/pending
 * conversation in the agent inbox. Pending threads are hidden from the
 * default Open filter, so a customer reply must surface them again.
 */
export function shouldReopenConversationOnInbound(args: {
  conversationStatus: string;
  suppressInboxReopen?: boolean;
}): boolean {
  if (args.suppressInboxReopen) return false;
  return (
    args.conversationStatus === "closed" ||
    args.conversationStatus === "followup" ||
    args.conversationStatus === "pending"
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
