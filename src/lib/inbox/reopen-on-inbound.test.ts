import { describe, expect, it } from "vitest";

import {
  shouldAttemptSqlReopenOnInbound,
  shouldReopenConversationOnInbound,
} from "./reopen-on-inbound";

describe("shouldReopenConversationOnInbound", () => {
  it("reopens closed, followup and pending conversations by default", () => {
    expect(
      shouldReopenConversationOnInbound({ conversationStatus: "closed" }),
    ).toBe(true);
    expect(
      shouldReopenConversationOnInbound({ conversationStatus: "followup" }),
    ).toBe(true);
    expect(
      shouldReopenConversationOnInbound({ conversationStatus: "pending" }),
    ).toBe(true);
  });

  it("does not reopen open conversations", () => {
    expect(
      shouldReopenConversationOnInbound({ conversationStatus: "open" }),
    ).toBe(false);
  });

  it("skips reopen when a flow closed the conversation on this inbound", () => {
    expect(
      shouldReopenConversationOnInbound({
        conversationStatus: "closed",
        suppressInboxReopen: true,
      }),
    ).toBe(false);
  });
});

describe("shouldAttemptSqlReopenOnInbound", () => {
  it("attempts SQL reopen by default", () => {
    expect(shouldAttemptSqlReopenOnInbound({})).toBe(true);
  });

  it("skips SQL reopen when a flow closed on this inbound", () => {
    expect(
      shouldAttemptSqlReopenOnInbound({ suppressInboxReopen: true }),
    ).toBe(false);
  });
});
