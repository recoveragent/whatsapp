import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import {
  applyEmbedFrameHeaders,
  redirectParamRequestsEmbed,
  shouldAllowIframeEmbed,
} from "./embed-headers";

describe("redirectParamRequestsEmbed", () => {
  it("detects embed=1 inside redirect targets", () => {
    expect(
      redirectParamRequestsEmbed(
        "/inbox?phone=%2B919876543210&embed=1&phone=+919876543210",
      ),
    ).toBe(true);
    expect(
      redirectParamRequestsEmbed(
        "/inbox?phone=%2B919876543210&embed%3D1&phone=+919876543210",
      ),
    ).toBe(true);
  });

  it("returns false when redirect has no embed flag", () => {
    expect(redirectParamRequestsEmbed("/inbox?phone=%2B919876543210")).toBe(
      false,
    );
  });
});

describe("shouldAllowIframeEmbed", () => {
  it("allows inbox with top-level embed=1", () => {
    expect(
      shouldAllowIframeEmbed(
        new NextRequest("https://wa.test/inbox?embed=1&phone=%2B919876543210"),
      ),
    ).toBe(true);
  });

  it("allows sso when embed=1 is nested in redirect", () => {
    expect(
      shouldAllowIframeEmbed(
        new NextRequest(
          "https://wa.test/sso?ticket=abc&redirect=/inbox?phone=%2B919876543210&embed%3D1",
        ),
      ),
    ).toBe(true);
  });

  it("denies embed on unrelated paths", () => {
    expect(
      shouldAllowIframeEmbed(new NextRequest("https://wa.test/dashboard?embed=1")),
    ).toBe(false);
  });

  it("denies inbox without embed=1", () => {
    expect(
      shouldAllowIframeEmbed(new NextRequest("https://wa.test/inbox?c=abc")),
    ).toBe(false);
  });
});

describe("applyEmbedFrameHeaders", () => {
  it("removes X-Frame-Options and sets frame-ancestors CSP", () => {
    const res = NextResponse.next();
    res.headers.set("X-Frame-Options", "DENY");
    applyEmbedFrameHeaders(res);

    expect(res.headers.get("X-Frame-Options")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self' https://dashboard.recoveragent.ai http://localhost:5173",
    );
  });
});
