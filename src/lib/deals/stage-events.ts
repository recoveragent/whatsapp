import type { SupabaseClient } from "@supabase/supabase-js";

import type { DealStageEvent } from "@/types";

export const STAGE_MOVE_NOTE_PATTERN = /^Moved (.+) → (.+): (.+)$/;

export function parseStageMoveNoteLine(
  line: string,
): { fromStageName: string; toStageName: string; reason: string } | null {
  const match = line.trim().match(STAGE_MOVE_NOTE_PATTERN);
  if (!match) return null;
  return {
    fromStageName: match[1].trim(),
    toStageName: match[2].trim(),
    reason: match[3].trim(),
  };
}

export function parseStageMoveNotes(notes?: string | null) {
  if (!notes?.trim()) return [];
  return notes
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseStageMoveNoteLine)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

type StageEventInsert = {
  deal_id: string;
  account_id: string;
  event_type: DealStageEvent["event_type"];
  from_stage_id?: string | null;
  to_stage_id?: string | null;
  from_stage_name?: string | null;
  to_stage_name?: string | null;
  reason?: string | null;
  user_id?: string | null;
  created_at?: string;
};

async function insertStageEvent(
  supabase: SupabaseClient,
  row: StageEventInsert,
): Promise<void> {
  const payload = { ...row };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  const { error } = await supabase.from("deal_stage_events").insert(payload);
  if (error) {
    console.error("[deal_stage_events] insert failed:", error.message);
  }
}

export async function recordDealReceivedEvent(
  supabase: SupabaseClient,
  args: {
    dealId: string;
    accountId: string;
    stageId: string;
    stageName: string;
    userId?: string | null;
    createdAt?: string;
  },
): Promise<void> {
  await insertStageEvent(supabase, {
    deal_id: args.dealId,
    account_id: args.accountId,
    event_type: "received",
    to_stage_id: args.stageId,
    to_stage_name: args.stageName,
    user_id: args.userId ?? null,
    created_at: args.createdAt,
  });
}

export async function recordDealStageMoveEvent(
  supabase: SupabaseClient,
  args: {
    dealId: string;
    accountId: string;
    fromStageId: string;
    toStageId: string;
    fromStageName: string;
    toStageName: string;
    reason: string;
    userId?: string | null;
  },
): Promise<void> {
  await insertStageEvent(supabase, {
    deal_id: args.dealId,
    account_id: args.accountId,
    event_type: "stage_move",
    from_stage_id: args.fromStageId,
    to_stage_id: args.toStageId,
    from_stage_name: args.fromStageName,
    to_stage_name: args.toStageName,
    reason: args.reason,
    user_id: args.userId ?? null,
  });
}
