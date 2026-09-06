import { describe, expect, it, vi } from "vitest";

import { buildEmbedInboxUrl } from "./query";
import {
  isRecoverAgentEmbedMessage,
  notifyRecoverAgentEmbedClose,
  RECOVER_AGENT_DASHBOARD_ORIGIN,
} from "./recover-agent";

describe("buildEmbedInboxUrl", () => {
  it("always includes embed=1 and preserves phone + conversation", () => {
    expect(
      buildEmbedInboxUrl({
        phone: "+919876543210",
        conversationId: "conv-1",
      }),
    ).toBe("/inbox?embed=1&phone=%2B919876543210&c=conv-1");
  });
});

describe("isRecoverAgentEmbedMessage", () => {
  it("accepts close and open actions", () => {
    expect(
      isRecoverAgentEmbedMessage({
        type: "recoveragent:wa-embed",
        action: "close",
      }),
    ).toBe(true);
    expect(
      isRecoverAgentEmbedMessage({
        type: "recoveragent:wa-embed",
        action: "open",
        phone: "+919876543210",
      }),
    ).toBe(true);
  });

  it("rejects unknown payloads", () => {
    expect(isRecoverAgentEmbedMessage(null)).toBe(false);
    expect(isRecoverAgentEmbedMessage({ type: "other", action: "close" })).toBe(
      false,
    );
  });
});

describe("notifyRecoverAgentEmbedClose", () => {
  it("posts close message to the dashboard origin", () => {
    const postMessage = vi.fn();
    const parent = { postMessage } as unknown as Window;
    vi.stubGlobal("window", { parent } as Window);

    notifyRecoverAgentEmbedClose();

    expect(postMessage).toHaveBeenCalledWith(
      { type: "recoveragent:wa-embed", action: "close" },
      RECOVER_AGENT_DASHBOARD_ORIGIN,
    );

    vi.unstubAllGlobals();
  });
});
