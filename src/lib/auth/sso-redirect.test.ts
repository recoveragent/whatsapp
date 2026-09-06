import { describe, expect, it } from "vitest";

import {
  isSafeRelativePath,
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

describe("resolveSsoPostLoginPath", () => {
  it("prefers a safe redirect param", () => {
    expect(
      resolveSsoPostLoginPath("/dashboard?phone=%2B919876543210", [
        "+919111111111",
      ]),
    ).toBe("/dashboard?phone=%2B919876543210");
  });

  it("falls back to inbox with phone when redirect is unsafe", () => {
    expect(resolveSsoPostLoginPath("//evil.com", ["+919876543210"])).toBe(
      "/inbox?phone=%2B919876543210",
    );
  });

  it("builds inbox phone link from standalone phone params", () => {
    expect(resolveSsoPostLoginPath(null, ["+919876543210"])).toBe(
      "/inbox?phone=%2B919876543210",
    );
    expect(resolveSsoPostLoginPath("", ["919876543210"])).toBe(
      "/inbox?phone=%2B919876543210",
    );
  });

  it("defaults to /dashboard when no redirect or valid phone", () => {
    expect(resolveSsoPostLoginPath(null, [])).toBe("/dashboard");
    expect(resolveSsoPostLoginPath(null, ["not-a-phone"])).toBe("/dashboard");
    expect(resolveSsoPostLoginPath("  ", [])).toBe("/dashboard");
  });
});
