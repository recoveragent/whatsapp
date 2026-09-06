import { describe, expect, it } from "vitest";

import {
  isSafeRelativePath,
  isSsoEmbedContext,
  reconstructSsoRedirect,
  resolveSsoPostLoginPath,
} from "./sso-redirect";

describe("isSafeRelativePath", () => {
  it("allows same-origin relative paths", () => {
    expect(isSafeRelativePath("/dashboard")).toBe(true);
    expect(isSafeRelativePath("/dashboard?phone=%2B919876543210")).toBe(true);
    expect(isSafeRelativePath("/inbox?c=abc")).toBe(true);
  });

  it("blocks open redirects", () => {
    expect(isSafeRelativePath("//evil.com")).toBe(false);
    expect(isSafeRelativePath("//evil.com/path")).toBe(false);
    expect(isSafeRelativePath("https://evil.com")).toBe(false);
    expect(isSafeRelativePath("dashboard")).toBe(false);
  });
});

describe("reconstructSsoRedirect", () => {
  it("re-merges embed=1 when split out of redirect by the URL parser", () => {
    expect(
      reconstructSsoRedirect({
        redirectParam: "/inbox?phone=%2B919876543210",
        phoneCandidates: ["+919876543210"],
        hasSplitEmbedParam: true,
      }),
    ).toBe("/inbox?phone=%2B919876543210&embed=1");
  });

  it("adds standalone phone when redirect omits it", () => {
    expect(
      reconstructSsoRedirect({
        redirectParam: "/inbox?embed=1",
        phoneCandidates: ["+919876543210"],
        embedTopLevel: true,
      }),
    ).toBe("/inbox?embed=1&phone=%2B919876543210");
  });
});

describe("resolveSsoPostLoginPath", () => {
  it("prefers a safe redirect param", () => {
    expect(
      resolveSsoPostLoginPath({
        redirectParam: "/dashboard?phone=%2B919876543210",
        phoneCandidates: ["+919111111111"],
      }),
    ).toBe("/dashboard?phone=%2B919876543210");
  });

  it("reconstructs dashboard SSO redirect with embed=1", () => {
    expect(
      resolveSsoPostLoginPath({
        redirectParam: "/inbox?phone=%2B919876543210",
        phoneCandidates: ["+919876543210"],
        hasSplitEmbedParam: true,
      }),
    ).toBe("/inbox?phone=%2B919876543210&embed=1");
  });

  it("falls back to embed inbox with phone when redirect is unsafe", () => {
    expect(
      resolveSsoPostLoginPath({
        redirectParam: "//evil.com",
        phoneCandidates: ["+919876543210"],
        hasSplitEmbedParam: true,
      }),
    ).toBe("/inbox?embed=1&phone=%2B919876543210");
  });

  it("builds embed inbox phone link from standalone phone params", () => {
    expect(
      resolveSsoPostLoginPath({
        redirectParam: null,
        phoneCandidates: ["+919876543210"],
        hasSplitEmbedParam: true,
      }),
    ).toBe("/inbox?embed=1&phone=%2B919876543210");
  });

  it("defaults to /inbox for non-embed SSO without phone", () => {
    expect(
      resolveSsoPostLoginPath({ redirectParam: null, phoneCandidates: [] }),
    ).toBe("/inbox");
  });

  it("defaults to embed inbox when embed context without phone", () => {
    expect(
      resolveSsoPostLoginPath({
        redirectParam: null,
        phoneCandidates: [],
        hasSplitEmbedParam: true,
      }),
    ).toBe("/inbox?embed=1");
  });
});

describe("isSsoEmbedContext", () => {
  it("detects inbox redirect as embed context", () => {
    expect(
      isSsoEmbedContext({
        redirectParam: "/inbox?phone=%2B919876543210",
        phoneCandidates: [],
      }),
    ).toBe(true);
  });
});
