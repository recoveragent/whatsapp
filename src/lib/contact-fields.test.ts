import { describe, expect, it } from "vitest";

import { resolveContactFieldLabel } from "./contact-fields";

describe("resolveContactFieldLabel", () => {
  it("maps built-in fields", () => {
    expect(resolveContactFieldLabel("name")).toBe("Name");
    expect(resolveContactFieldLabel("email")).toBe("Email");
    expect(resolveContactFieldLabel("company")).toBe("Company");
  });

  it("maps custom field ids to field names", () => {
    expect(
      resolveContactFieldLabel("custom:abc", [
        { id: "abc", field_name: "Platform" } as never,
      ]),
    ).toBe("Platform");
  });

  it("shows loading and unknown fallbacks for custom fields", () => {
    expect(
      resolveContactFieldLabel("custom:missing", [], { loading: true }),
    ).toBe("Loading…");
    expect(resolveContactFieldLabel("custom:missing", [])).toBe(
      "Unknown field",
    );
  });
});
