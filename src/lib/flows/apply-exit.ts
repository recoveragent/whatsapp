/**
 * End open flow runs whose `exit_config` matches a CRM / inbound event.
 *
 * Kept out of `engine.ts` so CRM dispatch can call it without a
 * circular import (engine → dispatch-triggers → apply-exit).
 */

import { supabaseAdmin } from "./admin-client";
import {
  endReasonForExit,
  exitConfigMatchesEvent,
  parseExitConfig,
  type FlowExitEvent,
} from "./exit-conditions";
import { isShopifyFulfillmentFlowTrigger } from "./trigger-types";

type AdminClient = ReturnType<typeof supabaseAdmin>;

const OPEN_RUN_STATUSES = ["active", "waiting"] as const;

export async function applyFlowExitEvent(input: {
  accountId: string;
  contactId: string;
  event: FlowExitEvent;
  /** Don't end a run of this flow (the one that's about to start). */
  exceptFlowId?: string;
  /** Don't end this run (the node that caused the event). */
  exceptRunId?: string;
}): Promise<{ endedRunIds: string[] }> {
  if (!input.contactId) return { endedRunIds: [] };
  const db = supabaseAdmin();
  return applyFlowExitEventWithClient(db, input);
}

export async function applyFlowExitEventWithClient(
  db: AdminClient,
  input: {
    accountId: string;
    contactId: string;
    event: FlowExitEvent;
    exceptFlowId?: string;
    exceptRunId?: string;
  },
): Promise<{ endedRunIds: string[] }> {
  const { data, error } = await db
    .from("flow_runs")
    .select("id, flow_id, current_node_key, status, flows!inner(exit_config)")
    .eq("account_id", input.accountId)
    .eq("contact_id", input.contactId)
    .in("status", [...OPEN_RUN_STATUSES]);

  if (error) {
    console.error("[flows] applyFlowExitEvent load error:", error.message);
    return { endedRunIds: [] };
  }

  const endedRunIds: string[] = [];
  for (const row of data ?? []) {
    const run = row as {
      id: string;
      flow_id: string;
      current_node_key: string | null;
      status: string;
      flows:
        | { exit_config: unknown }
        | { exit_config: unknown }[]
        | null;
    };
    if (input.exceptRunId && run.id === input.exceptRunId) continue;
    if (input.exceptFlowId && run.flow_id === input.exceptFlowId) continue;

    const flowsField = Array.isArray(run.flows) ? run.flows[0] : run.flows;
    const config = parseExitConfig(flowsField?.exit_config);
    if (!exitConfigMatchesEvent(config, input.event, run.flow_id)) continue;

    await completeRunForExit(db, run, input.event);
    endedRunIds.push(run.id);
  }
  return { endedRunIds };
}

/**
 * Shopify order-placed flows often suspend at send_template without
 * exit_config, which blocks fulfillment flows for the same contact.
 */
export async function endOrderPlacedRunsForFulfillmentWithClient(
  db: AdminClient,
  input: {
    accountId: string;
    contactId: string;
    incomingFlowId: string;
    incomingTriggerType: string;
  },
): Promise<{ endedRunIds: string[] }> {
  if (!isShopifyFulfillmentFlowTrigger(input.incomingTriggerType)) {
    return { endedRunIds: [] };
  }

  const { data, error } = await db
    .from("flow_runs")
    .select("id, flow_id, current_node_key, status, flows!inner(trigger_type)")
    .eq("account_id", input.accountId)
    .eq("contact_id", input.contactId)
    .in("status", [...OPEN_RUN_STATUSES]);

  if (error) {
    console.error(
      "[flows] endOrderPlacedRunsForFulfillment load error:",
      error.message,
    );
    return { endedRunIds: [] };
  }

  const endedRunIds: string[] = [];
  for (const row of data ?? []) {
    const run = row as {
      id: string;
      flow_id: string;
      current_node_key: string | null;
      flows:
        | { trigger_type: string | null }
        | { trigger_type: string | null }[]
        | null;
    };
    if (run.flow_id === input.incomingFlowId) continue;

    const flowsField = Array.isArray(run.flows) ? run.flows[0] : run.flows;
    if (flowsField?.trigger_type !== "shopify_order_placed") continue;

    await completeRunForExit(db, run, {
      type: "another_flow",
      incomingFlowId: input.incomingFlowId,
    });
    endedRunIds.push(run.id);
  }
  return { endedRunIds };
}

async function completeRunForExit(
  db: AdminClient,
  run: { id: string; current_node_key: string | null },
  event: FlowExitEvent,
): Promise<void> {
  const reason = endReasonForExit(event);
  const now = new Date().toISOString();
  await db
    .from("flow_runs")
    .update({
      status: "completed",
      ended_at: now,
      end_reason: reason,
    })
    .eq("id", run.id)
    .in("status", [...OPEN_RUN_STATUSES]);

  await db
    .from("flow_pending_executions")
    .update({ status: "failed" })
    .eq("flow_run_id", run.id)
    .eq("status", "pending");

  const { error } = await db.from("flow_run_events").insert({
    flow_run_id: run.id,
    event_type: "completed",
    node_key: run.current_node_key,
    payload: { reason, exit_event: event.type },
  });
  if (error) {
    console.error("[flows] applyFlowExitEvent log error:", error.message);
  }
}
