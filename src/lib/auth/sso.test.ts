import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateLink = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    auth: {
      admin: {
        generateLink: (...args: unknown[]) => generateLink(...args),
      },
    },
  }),
}));

const {
  SSO_APP,
  SSO_CONSUME_URL,
  completeSsoLogin,
  consumeSsoTicket,
  parseSsoConsumeResponse,
  shouldUseSharedHashedToken,
  ssoConsumeBody,
  ssoErrorHtml,
  SsoError,
  usesSharedRecoverAgentAuth,
} = await import("./sso");

const SHARED_URL = "https://huyoveugeexdhyqhawvq.supabase.co";

afterEach(() => {
  vi.unstubAllGlobals();
  generateLink.mockReset();
});

describe("ssoConsumeBody", () => {
  it('sends app "wa", never "voice"', () => {
    expect(ssoConsumeBody("ticket-1")).toEqual({
      ticket: "ticket-1",
      app: "wa",
    });
    expect(SSO_APP).toBe("wa");
    expect(SSO_APP).not.toBe("voice");
  });
});

describe("usesSharedRecoverAgentAuth", () => {
  it("is true only for the Recover Agent dashboard project", () => {
    expect(usesSharedRecoverAgentAuth(SHARED_URL)).toBe(true);
    expect(
      usesSharedRecoverAgentAuth("https://otherproject.supabase.co"),
    ).toBe(false);
    expect(usesSharedRecoverAgentAuth("")).toBe(false);
  });
});

describe("shouldUseSharedHashedToken", () => {
  it("requires both the shared project and a hashed_token", () => {
    expect(shouldUseSharedHashedToken("hash", SHARED_URL)).toBe(true);
    expect(shouldUseSharedHashedToken(undefined, SHARED_URL)).toBe(false);
    expect(
      shouldUseSharedHashedToken("hash", "https://other.supabase.co"),
    ).toBe(false);
  });
});

describe("parseSsoConsumeResponse", () => {
  it("reads identity and hashed_token", () => {
    expect(
      parseSsoConsumeResponse({
        identity: {
          email: "Ada@Brand.com",
          user_id: "user-1",
          company_id: "co-1",
          roles: ["admin"],
        },
        hashed_token: " tok ",
      }),
    ).toEqual({
      identity: {
        email: "ada@brand.com",
        user_id: "user-1",
        company_id: "co-1",
        roles: ["admin"],
      },
      hashed_token: "tok",
    });
  });

  it("rejects a payload without email", () => {
    expect(() =>
      parseSsoConsumeResponse({ identity: { user_id: "x" } }),
    ).toThrow(SsoError);
  });
});

describe("consumeSsoTicket", () => {
  it("POSTs ticket + app=wa to sso-consume with the dashboard apikey", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(SSO_CONSUME_URL);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("apikey")).toMatch(/^eyJ/);
      expect(JSON.parse(String(init?.body))).toEqual({
        ticket: "abc",
        app: "wa",
      });
      return new Response(
        JSON.stringify({
          identity: { email: "ada@brand.com", user_id: "u1" },
          hashed_token: "hash-1",
        }),
        { status: 200 },
      );
    });

    await expect(consumeSsoTicket("abc", fetchImpl)).resolves.toMatchObject({
      identity: { email: "ada@brand.com" },
      hashed_token: "hash-1",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps a failed consume to a short expired-ticket error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "expired" }), { status: 401 }),
    );

    await expect(consumeSsoTicket("dead", fetchImpl)).rejects.toMatchObject({
      publicMessage: expect.stringContaining("invalid or has expired"),
    });
  });
});

describe("completeSsoLogin", () => {
  const verifyOtp = vi.fn();

  beforeEach(() => {
    verifyOtp.mockReset();
    verifyOtp.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = SHARED_URL;
  });

  function client() {
    return { auth: { verifyOtp } } as never;
  }

  it("verifies the hashed_token on the shared project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            identity: { email: "ada@brand.com" },
            hashed_token: "shared-hash",
          }),
          { status: 200 },
        ),
      ),
    );

    await completeSsoLogin("ticket", client());

    expect(verifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "shared-hash",
      email: "ada@brand.com",
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("falls back to this app's magic-link session from identity", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://other.supabase.co";
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "local-hash" } },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            identity: {
              email: "ada@brand.com",
              user_id: "dash-user",
              company_id: "co-1",
              roles: ["admin"],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await completeSsoLogin("ticket", client());

    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "ada@brand.com",
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "local-hash",
      email: "ada@brand.com",
    });
  });

  it("rejects a missing ticket without calling consume", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);

    await expect(completeSsoLogin("  ", client())).rejects.toBeInstanceOf(
      SsoError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ssoErrorHtml", () => {
  it("escapes the message and links back to the dashboard", () => {
    const html = ssoErrorHtml(
      '<script>alert(1)</script>',
      "https://app.recoveragent.ai",
    );
    expect(html).toContain("Back to dashboard");
    expect(html).toContain('href="https://app.recoveragent.ai"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
