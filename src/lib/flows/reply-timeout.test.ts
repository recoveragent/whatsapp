import { describe, it, expect } from "vitest";
import {
  parseReplyTimeout,
  replyTimeoutMs,
  REPLY_TIMEOUT_HANDLE,
  isSuspendingNodeType,
  isReplyTimeoutEnabled,
  hasReplyTimeoutTiming,
  showReplyTimeoutHandle,
  TIMEOUT_LABEL,
} from "./reply-timeout";

describe("parseReplyTimeout", () => {
  it("returns null when config is incomplete", () => {
    expect(parseReplyTimeout({})).toBeNull();
    expect(
      parseReplyTimeout({
        reply_timeout_amount: 2,
        reply_timeout_unit: "hours",
      }),
    ).toBeNull();
    expect(
      parseReplyTimeout({
        reply_timeout_next_node_key: "follow_up",
      }),
    ).toBeNull();
  });

  it("parses a valid timeout config", () => {
    expect(
      parseReplyTimeout({
        reply_timeout_enabled: true,
        reply_timeout_amount: 30,
        reply_timeout_unit: "minutes",
        reply_timeout_next_node_key: "nudge",
      }),
    ).toEqual({
      amount: 30,
      unit: "minutes",
      next_node_key: "nudge",
    });
  });

  it("requires enabled flag for new configs", () => {
    expect(
      parseReplyTimeout({
        reply_timeout_enabled: false,
        reply_timeout_amount: 30,
        reply_timeout_unit: "minutes",
        reply_timeout_next_node_key: "nudge",
      }),
    ).toBeNull();
  });

  it("shows canvas handle only when enabled with timing", () => {
    expect(showReplyTimeoutHandle({ reply_timeout_enabled: true })).toBe(false);
    expect(
      showReplyTimeoutHandle({
        reply_timeout_enabled: true,
        reply_timeout_amount: 2,
        reply_timeout_unit: "hours",
      }),
    ).toBe(true);
    expect(
      showReplyTimeoutHandle({
        reply_timeout_next_node_key: "orphan",
      }),
    ).toBe(false);
  });

  it("rejects invalid amounts and units", () => {
    expect(
      parseReplyTimeout({
        reply_timeout_amount: 0,
        reply_timeout_unit: "hours",
        reply_timeout_next_node_key: "x",
      }),
    ).toBeNull();
    expect(
      parseReplyTimeout({
        reply_timeout_amount: 1,
        reply_timeout_unit: "weeks",
        reply_timeout_next_node_key: "x",
      }),
    ).toBeNull();
  });
});

describe("replyTimeoutMs", () => {
  it("converts units to milliseconds", () => {
    expect(
      replyTimeoutMs({ amount: 2, unit: "minutes", next_node_key: "a" }),
    ).toBe(120_000);
    expect(
      replyTimeoutMs({ amount: 3, unit: "hours", next_node_key: "a" }),
    ).toBe(10_800_000);
    expect(
      replyTimeoutMs({ amount: 1, unit: "days", next_node_key: "a" }),
    ).toBe(86_400_000);
  });
});

describe("isSuspendingNodeType", () => {
  it("includes interactive and capture nodes", () => {
    expect(isSuspendingNodeType("send_buttons")).toBe(true);
    expect(isSuspendingNodeType("send_list")).toBe(true);
    expect(isSuspendingNodeType("collect_input")).toBe(true);
    expect(isSuspendingNodeType("send_address")).toBe(true);
    expect(isSuspendingNodeType("send_template")).toBe(true);
    expect(isSuspendingNodeType("send_message")).toBe(false);
  });
});

describe("TIMEOUT_LABEL", () => {
  it("is distinct from the Next step label", () => {
    expect(TIMEOUT_LABEL).toBe("Timeout");
  });
});
