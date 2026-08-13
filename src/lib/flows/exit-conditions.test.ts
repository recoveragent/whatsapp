import { describe, expect, it } from "vitest";
import {
  conditionMatchesEvent,
  emptyExitCondition,
  exitConfigMatchesEvent,
  parseExitConfig,
  summarizeExitConfig,
  type FlowExitConfig,
} from "./exit-conditions";

const FLOW_A = "flow-a";
const FLOW_B = "flow-b";

describe("parseExitConfig", () => {
  it("returns empty conditions for null / garbage", () => {
    expect(parseExitConfig(null)).toEqual({ conditions: [] });
    expect(parseExitConfig(undefined)).toEqual({ conditions: [] });
    expect(parseExitConfig("nope")).toEqual({ conditions: [] });
    expect(parseExitConfig({})).toEqual({ conditions: [] });
  });

  it("drops unknown types and keeps valid rows", () => {
    const parsed = parseExitConfig({
      conditions: [
        { id: "1", type: "tag_added", tag_id: "tag-1" },
        { id: "2", type: "not_a_real_type" },
        { type: "another_flow" },
      ],
    });
    expect(parsed.conditions).toHaveLength(2);
    expect(parsed.conditions[0]).toMatchObject({ type: "tag_added", tag_id: "tag-1" });
    expect(parsed.conditions[1].type).toBe("another_flow");
    expect(parsed.conditions[1].id).toBeTruthy();
  });
});

describe("conditionMatchesEvent", () => {
  it("ends on any other flow when flow_ids is empty", () => {
    const c = emptyExitCondition("another_flow");
    expect(
      conditionMatchesEvent(c, { type: "another_flow", incomingFlowId: FLOW_B }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(c, { type: "another_flow", incomingFlowId: FLOW_A }, FLOW_A),
    ).toBe(false);
  });

  it("ends only when the incoming flow is in flow_ids", () => {
    const c = {
      ...emptyExitCondition("another_flow"),
      flow_ids: [FLOW_B, "flow-c"],
    };
    expect(
      conditionMatchesEvent(c, { type: "another_flow", incomingFlowId: FLOW_B }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(c, { type: "another_flow", incomingFlowId: "flow-c" }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(c, { type: "another_flow", incomingFlowId: "flow-d" }, FLOW_A),
    ).toBe(false);
  });

  it("migrates legacy flow_id on parse", () => {
    const parsed = parseExitConfig({
      conditions: [{ id: "1", type: "another_flow", flow_id: FLOW_B }],
    });
    expect(parsed.conditions[0]?.flow_ids).toEqual([FLOW_B]);
  });

  it("matches tag added / removed by id", () => {
    const add = { ...emptyExitCondition("tag_added"), tag_id: "vip" };
    const remove = { ...emptyExitCondition("tag_removed"), tag_id: "vip" };
    expect(conditionMatchesEvent(add, { type: "tag_added", tagId: "vip" }, FLOW_A)).toBe(
      true,
    );
    expect(conditionMatchesEvent(add, { type: "tag_added", tagId: "other" }, FLOW_A)).toBe(
      false,
    );
    expect(
      conditionMatchesEvent(remove, { type: "tag_removed", tagId: "vip" }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(add, { type: "tag_removed", tagId: "vip" }, FLOW_A),
    ).toBe(false);
  });

  it("does not match a tag condition with no tag_id", () => {
    const c = emptyExitCondition("tag_added");
    expect(conditionMatchesEvent(c, { type: "tag_added", tagId: "vip" }, FLOW_A)).toBe(
      false,
    );
  });

  it("matches deal stage by stage_id", () => {
    const c = { ...emptyExitCondition("deal_stage"), stage_id: "won" };
    expect(
      conditionMatchesEvent(c, { type: "deal_stage", stageId: "won" }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(c, { type: "deal_stage", stageId: "lost" }, FLOW_A),
    ).toBe(false);
  });

  it("matches keywords contains / exact, case-insensitive", () => {
    const contains = {
      ...emptyExitCondition("keyword"),
      keywords: ["stop", "unsubscribe"],
      match_type: "contains" as const,
    };
    expect(
      conditionMatchesEvent(contains, { type: "keyword", text: "Please STOP this" }, FLOW_A),
    ).toBe(true);
    expect(
      conditionMatchesEvent(contains, { type: "keyword", text: "hello" }, FLOW_A),
    ).toBe(false);

    const exact = {
      ...emptyExitCondition("keyword"),
      keywords: ["stop"],
      match_type: "exact" as const,
    };
    expect(conditionMatchesEvent(exact, { type: "keyword", text: "STOP" }, FLOW_A)).toBe(
      true,
    );
    expect(
      conditionMatchesEvent(exact, { type: "keyword", text: "please stop" }, FLOW_A),
    ).toBe(false);
  });

  it("matches conversation assigned with no extra config", () => {
    const c = emptyExitCondition("conversation_assigned");
    expect(conditionMatchesEvent(c, { type: "conversation_assigned" }, FLOW_A)).toBe(true);
    expect(
      conditionMatchesEvent(c, { type: "tag_added", tagId: "x" }, FLOW_A),
    ).toBe(false);
  });
});

describe("exitConfigMatchesEvent", () => {
  it("is true when any condition matches", () => {
    const config: FlowExitConfig = {
      conditions: [
        { ...emptyExitCondition("tag_added"), tag_id: "nope" },
        { ...emptyExitCondition("deal_stage"), stage_id: "won" },
      ],
    };
    expect(
      exitConfigMatchesEvent(config, { type: "deal_stage", stageId: "won" }, FLOW_A),
    ).toBe(true);
    expect(
      exitConfigMatchesEvent(config, { type: "deal_stage", stageId: "lost" }, FLOW_A),
    ).toBe(false);
  });
});

describe("summarizeExitConfig", () => {
  it("returns null when empty", () => {
    expect(summarizeExitConfig({ conditions: [] })).toBeNull();
  });

  it("summarizes one or many", () => {
    expect(
      summarizeExitConfig({ conditions: [emptyExitCondition("tag_added")] }),
    ).toMatch(/tag/i);
    expect(
      summarizeExitConfig({
        conditions: [emptyExitCondition("tag_added"), emptyExitCondition("keyword")],
      }),
    ).toBe("Ends on 2 conditions");
  });
});
