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
