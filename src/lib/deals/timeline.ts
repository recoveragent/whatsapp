import type { Deal, DealStageEvent, PipelineStage } from "@/types";

import { parseStageMoveNotes } from "@/lib/deals/stage-events";

export type DealTimelineItem =
  | {
      kind: "received";
      created_at: string;
      stageName: string;
      stageColor?: string;
    }
  | {
      kind: "stage_move";
      created_at: string;
      fromStageName: string;
      toStageName: string;
      reason: string;
      toStageColor?: string;
    }
  | {
      kind: "current";
      stageName: string;
      stageColor?: string;
      since?: string;
    };

function stageColorByName(
  stages: Pick<PipelineStage, "name" | "color">[],
  name: string,
): string | undefined {
  const normalized = name.trim().toLowerCase();
  return stages.find((stage) => stage.name.trim().toLowerCase() === normalized)
    ?.color;
}

function lastStageNameInTimeline(items: DealTimelineItem[]): string | null {
  const last = items.at(-1);
  if (!last) return null;
  if (last.kind === "received") return last.stageName;
  if (last.kind === "stage_move") return last.toStageName;
  return last.stageName;
}

export function buildDealTimelineFromEvents(
  events: DealStageEvent[],
  deal: Pick<Deal, "stage_id" | "updated_at">,
  stages: Pick<PipelineStage, "id" | "name" | "color">[],
): DealTimelineItem[] {
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const items: DealTimelineItem[] = [];

  for (const event of sorted) {
    if (event.event_type === "received") {
      const stage = event.to_stage_id
        ? stageById.get(event.to_stage_id)
        : undefined;
      items.push({
        kind: "received",
        created_at: event.created_at,
        stageName: event.to_stage_name ?? stage?.name ?? "Unknown",
        stageColor: stage?.color ?? stageColorByName(stages, event.to_stage_name ?? ""),
      });
      continue;
    }

    if (event.event_type === "stage_move") {
      const toStage = event.to_stage_id
        ? stageById.get(event.to_stage_id)
        : undefined;
      items.push({
        kind: "stage_move",
        created_at: event.created_at,
        fromStageName: event.from_stage_name ?? "Unknown",
        toStageName: event.to_stage_name ?? "Unknown",
        reason: event.reason?.trim() ?? "",
        toStageColor:
          toStage?.color ?? stageColorByName(stages, event.to_stage_name ?? ""),
      });
    }
  }

  const currentStage = stageById.get(deal.stage_id);
  const lastStageName = lastStageNameInTimeline(items);

  if (
    currentStage &&
    lastStageName &&
    lastStageName.trim().toLowerCase() !== currentStage.name.trim().toLowerCase()
  ) {
    items.push({
      kind: "current",
      stageName: currentStage.name,
      stageColor: currentStage.color,
      since: deal.updated_at,
    });
  }

  return items;
}

/** Fallback when structured events are unavailable (pre-migration deals). */
export function buildDealTimelineFromNotes(
  deal: Pick<Deal, "created_at" | "updated_at" | "stage_id" | "notes">,
  stages: Pick<PipelineStage, "id" | "name" | "color">[],
): DealTimelineItem[] {
  const moves = parseStageMoveNotes(deal.notes);
  const currentStage = stages.find((stage) => stage.id === deal.stage_id);
  const initialStageName =
    moves[0]?.fromStageName ?? currentStage?.name ?? "Unknown";

  const items: DealTimelineItem[] = [
    {
      kind: "received",
      created_at: deal.created_at,
      stageName: initialStageName,
      stageColor: stageColorByName(stages, initialStageName),
    },
  ];

  for (const move of moves) {
    items.push({
      kind: "stage_move",
      created_at: deal.updated_at ?? deal.created_at,
      fromStageName: move.fromStageName,
      toStageName: move.toStageName,
      reason: move.reason,
      toStageColor: stageColorByName(stages, move.toStageName),
    });
  }

  if (
    currentStage &&
    lastStageNameInTimeline(items)?.trim().toLowerCase() !==
      currentStage.name.trim().toLowerCase()
  ) {
    items.push({
      kind: "current",
      stageName: currentStage.name,
      stageColor: currentStage.color,
      since: deal.updated_at,
    });
  }

  return items;
}

export function buildDealTimeline(
  events: DealStageEvent[],
  deal: Pick<
    Deal,
    "created_at" | "updated_at" | "stage_id" | "notes"
  >,
  stages: Pick<PipelineStage, "id" | "name" | "color">[],
): DealTimelineItem[] {
  if (events.length > 0) {
    return buildDealTimelineFromEvents(events, deal, stages);
  }
  return buildDealTimelineFromNotes(deal, stages);
}
