/**
 * No-reply timeout branch for nodes that suspend awaiting customer input.
 *
 * Config lives on the node JSONB:
 *   reply_timeout_amount, reply_timeout_unit, reply_timeout_next_node_key
 *
 * Cron resumes `reply_timeout` rows while the run is still `active` on
 * the same source node; successful replies cancel the pending row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowRunRow } from "./types";

export type ReplyTimeoutUnit = "minutes" | "hours" | "days";

export interface ReplyTimeoutConfig {
  amount: number;
  unit: ReplyTimeoutUnit;
  next_node_key: string;
}

const UNITS: ReplyTimeoutUnit[] = ["minutes", "hours", "days"];

export function hasReplyTimeoutTiming(
  config: Record<string, unknown>,
): boolean {
  const amountRaw = config.reply_timeout_amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw)
        : NaN;
  if (!Number.isFinite(amount) || amount < 1) return false;

  const unit = config.reply_timeout_unit;
  return typeof unit === "string" && UNITS.includes(unit as ReplyTimeoutUnit);
}

/** User opted in via the node panel checkbox (legacy: timing alone counts). */
export function isReplyTimeoutEnabled(
  config: Record<string, unknown>,
): boolean {
  if (config.reply_timeout_enabled === true) return true;
  if (config.reply_timeout_enabled === false) return false;
  return hasReplyTimeoutTiming(config);
}

/** Show the Timeout canvas handle — enabled plus a valid duration. */
export function showReplyTimeoutHandle(
  config: Record<string, unknown>,
): boolean {
  return isReplyTimeoutEnabled(config) && hasReplyTimeoutTiming(config);
}

export function parseReplyTimeout(
  config: Record<string, unknown>,
): ReplyTimeoutConfig | null {
  if (!isReplyTimeoutEnabled(config) || !hasReplyTimeoutTiming(config)) {
    return null;
  }

  const amountRaw = config.reply_timeout_amount;
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw)
        : NaN;
  if (!Number.isFinite(amount) || amount < 1) return null;

  const unit = config.reply_timeout_unit;
  if (typeof unit !== "string" || !UNITS.includes(unit as ReplyTimeoutUnit)) {
    return null;
  }

  const next =
    typeof config.reply_timeout_next_node_key === "string"
      ? config.reply_timeout_next_node_key.trim()
      : "";
  if (!next) return null;

  return {
    amount: Math.floor(amount),
    unit: unit as ReplyTimeoutUnit,
    next_node_key: next,
  };
}

export function replyTimeoutMs(cfg: ReplyTimeoutConfig): number {
  const mult =
    cfg.unit === "minutes" ? 60_000 : cfg.unit === "hours" ? 3_600_000 : 86_400_000;
  return cfg.amount * mult;
}

export function replyTimeoutRunAt(cfg: ReplyTimeoutConfig): string {
  return new Date(Date.now() + replyTimeoutMs(cfg)).toISOString();
}

type AdminClient = SupabaseClient;

/** Schedule (or replace) a no-reply timeout for the current suspending node. */
export async function scheduleReplyTimeout(
  db: AdminClient,
  run: FlowRunRow,
  sourceNodeKey: string,
  cfg: ReplyTimeoutConfig,
): Promise<void> {
  await cancelReplyTimeout(db, run.id, sourceNodeKey);
  const { error } = await db.from("flow_pending_executions").insert({
    flow_run_id: run.id,
    flow_id: run.flow_id,
    account_id: run.account_id,
    user_id: run.user_id,
    contact_id: run.contact_id,
    conversation_id: run.conversation_id,
    next_node_key: cfg.next_node_key,
    vars: run.vars ?? {},
    run_at: replyTimeoutRunAt(cfg),
    status: "pending",
    execution_kind: "reply_timeout",
    source_node_key: sourceNodeKey,
  });
  if (error) {
    console.error("[flows] scheduleReplyTimeout:", error.message);
  }
}

/** Cancel a pending no-reply timeout (e.g. customer replied). */
export async function cancelReplyTimeout(
  db: AdminClient,
  flowRunId: string,
  sourceNodeKey: string,
): Promise<void> {
  const { error } = await db
    .from("flow_pending_executions")
    .update({ status: "failed" })
    .eq("flow_run_id", flowRunId)
    .eq("source_node_key", sourceNodeKey)
    .eq("status", "pending")
    .eq("execution_kind", "reply_timeout");
  if (error) {
    console.error("[flows] cancelReplyTimeout:", error.message);
  }
}

/** Cancel all pending idle timeouts for a run (any customer activity). */
export async function cancelAllReplyTimeouts(
  db: AdminClient,
  flowRunId: string,
): Promise<void> {
  const { error } = await db
    .from("flow_pending_executions")
    .update({ status: "failed" })
    .eq("flow_run_id", flowRunId)
    .eq("status", "pending")
    .eq("execution_kind", "reply_timeout");
  if (error) {
    console.error("[flows] cancelAllReplyTimeouts:", error.message);
  }
}

export const NEXT_STEP_LABEL = "Next step";

export const TIMEOUT_LABEL = "Timeout";

export const REPLY_TIMEOUT_HANDLE = "timeout";

/** Canvas + config: idle-timeout slot on nodes that wait for customer input. */
export function nodeTypeHasReplyTimeoutSlot(nodeType: string): boolean {
  return isSuspendingNodeType(nodeType);
}

/** Nodes that pause the run until the customer replies. */
export function isSuspendingNodeType(nodeType: string): boolean {
  return (
    nodeType === "send_buttons" ||
    nodeType === "send_list" ||
    nodeType === "collect_input" ||
    nodeType === "send_address" ||
    nodeType === "send_template"
  );
}
