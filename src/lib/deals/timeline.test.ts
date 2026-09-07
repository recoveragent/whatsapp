import { describe, expect, it } from "vitest";

import { parseStageMoveNoteLine } from "@/lib/deals/stage-events";
import { buildDealTimeline } from "@/lib/deals/timeline";
import type { DealStageEvent } from "@/types";

describe("parseStageMoveNoteLine", () => {
  it("parses a stage move note", () => {
    expect(
      parseStageMoveNoteLine("Moved New Lead → Qualified: Budget confirmed"),
    ).toEqual({
      fromStageName: "New Lead",
      toStageName: "Qualified",
      reason: "Budget confirmed",
    });
  });

  it("returns null for freeform notes", () => {
    expect(parseStageMoveNoteLine("Called customer, no answer")).toBeNull();
  });
});

describe("buildDealTimeline", () => {
  const stages = [
    { id: "s1", name: "New Lead", color: "#3b82f6" },
    { id: "s2", name: "Qualified", color: "#eab308" },
    { id: "s3", name: "Proposal Sent", color: "#f97316" },
  ];

  it("builds a received → moves → current timeline from events", () => {
    const events: DealStageEvent[] = [
      {
        id: "e1",
        deal_id: "d1",
        account_id: "a1",
        event_type: "received",
        to_stage_id: "s1",
        to_stage_name: "New Lead",
        created_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "e2",
        deal_id: "d1",
        account_id: "a1",
        event_type: "stage_move",
        from_stage_id: "s1",
        to_stage_id: "s2",
        from_stage_name: "New Lead",
        to_stage_name: "Qualified",
        reason: "Budget confirmed",
        created_at: "2026-03-02T10:00:00.000Z",
      },
    ];

    const timeline = buildDealTimeline(
      events,
      {
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-03T10:00:00.000Z",
        stage_id: "s3",
        notes: "",
      },
      stages,
    );

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({
      kind: "received",
      stageName: "New Lead",
    });
    expect(timeline[1]).toMatchObject({
      kind: "stage_move",
      toStageName: "Qualified",
      reason: "Budget confirmed",
    });
    expect(timeline[2]).toMatchObject({
      kind: "current",
      stageName: "Proposal Sent",
    });
  });

  it("falls back to notes when no events exist", () => {
    const timeline = buildDealTimeline(
      [],
      {
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-02T10:00:00.000Z",
        stage_id: "s2",
        notes: "Moved New Lead → Qualified: Budget confirmed",
      },
      stages,
    );

    expect(timeline[0]?.kind).toBe("received");
    expect(timeline[1]).toMatchObject({
      kind: "stage_move",
      toStageName: "Qualified",
    });
  });
});
