import { describe, expect, it } from "vitest";

import { resolvePipelineLabel, resolveStageLabel } from "./pipelines";

describe("resolvePipelineLabel", () => {
  it("maps pipeline ids to names", () => {
    expect(
      resolvePipelineLabel("p1", [{ id: "p1", name: "Sales" }]),
    ).toBe("Sales");
  });

  it("shows loading and unknown fallbacks", () => {
    expect(resolvePipelineLabel("p1", [], { loading: true })).toBe("Loading…");
    expect(resolvePipelineLabel("p1", [])).toBe("Unknown pipeline");
    expect(resolvePipelineLabel("", [])).toBe("");
  });
});

describe("resolveStageLabel", () => {
  it("maps stage ids to names", () => {
    expect(
      resolveStageLabel("s1", [
        { id: "s1", pipeline_id: "p1", name: "New lead" },
      ]),
    ).toBe("New lead");
  });

  it("shows loading and unknown fallbacks", () => {
    expect(resolveStageLabel("s1", [], { loading: true })).toBe("Loading…");
    expect(resolveStageLabel("s1", [])).toBe("Unknown stage");
  });
});
