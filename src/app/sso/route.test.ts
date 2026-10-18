import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  completeSsoLogin: vi.fn(),
  importConnection: vi.fn(),
  sessionClient: {},
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    options.cookies.setAll([
      { name: "session", value: "authenticated", options: { httpOnly: true } },
    ]);
    return mocks.sessionClient;
  }),
}));
vi.mock("@/lib/auth/sso", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/sso")>()),
  completeSsoLogin: mocks.completeSsoLogin,
}));
vi.mock("@/lib/shopify/recover-agent-import", () => ({
  importRecoverAgentShopifyConnection: mocks.importConnection,
}));
vi.mock("@/lib/auth/site-url", () => ({
  getServerRedirectOrigin: () => "https://wa.recoveragent.ai",
}));

import { GET } from "./route";
import { SsoError } from "@/lib/auth/sso";

describe("SSO Shopify handoff", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.completeSsoLogin.mockReset();
    mocks.importConnection.mockReset();
    mocks.completeSsoLogin.mockResolvedValue({
      identity: { email: "owner@example.com" },
      shopify_connection: {
        shop_domain: "brand.myshopify.com",
        access_token: "test-token",
      },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function request() {
    return new NextRequest(
      "https://wa.recoveragent.ai/sso?ticket=test&redirect=%2Finbox%3Fembed%3D1",
    );
  }

  it(
    "preserves the inbox redirect and session after Shopify imports successfully",
    async () => {
      const response = await GET(request());
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://wa.recoveragent.ai/inbox?embed=1",
      );
      expect(response.cookies.get("session")?.value).toBe("authenticated");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-security-policy")).toContain(
        "https://dashboard.recoveragent.ai",
      );
      expect(mocks.importConnection).toHaveBeenCalledOnce();
    },
  );

  it("blocks entry when the Shopify connection cannot be synchronized", async () => {
    mocks.importConnection.mockRejectedValue(new Error("Shopify token renewal failed"));
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Shopify connection import failed");
    expect(response.cookies.get("session")).toBeUndefined();
  });

  it("still rejects failed authentication without importing Shopify", async () => {
    mocks.completeSsoLogin.mockRejectedValue(new SsoError("Expired ticket"));
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Expired ticket");
    expect(response.cookies.get("session")).toBeUndefined();
    expect(mocks.importConnection).not.toHaveBeenCalled();
  });

  it("opens the inbox when no Shopify connection is supplied", async () => {
    mocks.completeSsoLogin.mockResolvedValue({
      identity: { email: "owner@example.com" },
    });
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(mocks.importConnection).not.toHaveBeenCalled();
  });
});
