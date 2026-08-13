/**
 * Flow-level exit conditions — when a live run should stop early.
 *
 * These are NOT graph nodes. They live on `flows.exit_config` and
 * fire on CRM / inbound / "another flow started" events, then call
 * the existing end-run path. Matching is pure so tests don't need a
 * database; `apply-exit.ts` does the I/O.
 */

export const FLOW_EXIT_CONDITION_TYPES = [
  "another_flow",
  "tag_added",
  "tag_removed",
  "deal_stage",
  "keyword",
  "conversation_assigned",
] as const;

export type FlowExitConditionType = (typeof FLOW_EXIT_CONDITION_TYPES)[number];

export const FLOW_EXIT_CONDITION_LABELS: Record<FlowExitConditionType, string> = {
  another_flow: "They enter another flow",
  tag_added: "A tag is added",
  tag_removed: "A tag is removed",
  deal_stage: "Lead stage is moved to…",
  keyword: "They send a keyword",
  conversation_assigned: "Conversation is assigned",
};

export interface FlowExitCondition {
  /** Stable client id for list keys. */
  id: string;
  type: FlowExitConditionType;
  /** tag_added / tag_removed */
  tag_id?: string;
  /** deal_stage */
  pipeline_id?: string;
  stage_id?: string;
  /**
   * another_flow: empty / omitted = any other flow; otherwise end when
   * the contact enters any of these flow ids.
   */
  flow_ids?: string[];
  /** @deprecated Use `flow_ids`. Parsed for backward compat only. */
  flow_id?: string;
  /** keyword */
  keywords?: string[];
  match_type?: "contains" | "exact";
}

export interface FlowExitConfig {
  conditions: FlowExitCondition[];
}

export const DEFAULT_EXIT_CONFIG: FlowExitConfig = { conditions: [] };

export type FlowExitEvent =
  | { type: "another_flow"; incomingFlowId: string }
  | { type: "tag_added"; tagId: string }
  | { type: "tag_removed"; tagId: string }
  | { type: "deal_stage"; stageId: string }
  | { type: "keyword"; text: string }
  | { type: "conversation_assigned" };

export function isFlowExitConditionType(v: string): v is FlowExitConditionType {
  return (FLOW_EXIT_CONDITION_TYPES as readonly string[]).includes(v);
}

export function emptyExitCondition(type: FlowExitConditionType): FlowExitCondition {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `exit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (type === "keyword") {
    return { id, type, keywords: [], match_type: "contains" };
  }
  if (type === "another_flow") {
    return { id, type, flow_ids: [] };
  }
  return { id, type };
}

/**
 * Merge a partial / null `exit_config` JSONB blob with the empty
 * default so older flow rows (pre-049) don't crash the runner.
 */
export function parseExitConfig(raw: unknown): FlowExitConfig {
  if (!raw || typeof raw !== "object") return { conditions: [] };
  const conditionsRaw = (raw as { conditions?: unknown }).conditions;
  if (!Array.isArray(conditionsRaw)) return { conditions: [] };
  const conditions: FlowExitCondition[] = [];
  for (const item of conditionsRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";
    if (!isFlowExitConditionType(type)) continue;
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id
        : `exit_${conditions.length}`;
    const next: FlowExitCondition = { id, type };
    if (typeof row.tag_id === "string") next.tag_id = row.tag_id;
    if (typeof row.pipeline_id === "string") next.pipeline_id = row.pipeline_id;
    if (typeof row.stage_id === "string") next.stage_id = row.stage_id;
    if (Array.isArray(row.flow_ids)) {
      next.flow_ids = row.flow_ids.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      );
    } else if (typeof row.flow_id === "string" && row.flow_id.trim()) {
      next.flow_ids = [row.flow_id.trim()];
    }
    if (Array.isArray(row.keywords)) {
      next.keywords = row.keywords.filter((k): k is string => typeof k === "string");
    }
    if (row.match_type === "exact" || row.match_type === "contains") {
      next.match_type = row.match_type;
    }
    conditions.push(next);
  }
  return { conditions };
}

export function exitConfigHasConditions(config: FlowExitConfig): boolean {
  return config.conditions.length > 0;
}

/**
 * True when any authored condition matches this event for `thisFlowId`.
 * `thisFlowId` is the run's parent flow — used so "another flow"
 * never matches the flow that's already running.
 */
export function exitConfigMatchesEvent(
  config: FlowExitConfig,
  event: FlowExitEvent,
  thisFlowId: string,
): boolean {
  return config.conditions.some((c) =>
    conditionMatchesEvent(c, event, thisFlowId),
  );
}

export function conditionMatchesEvent(
  condition: FlowExitCondition,
  event: FlowExitEvent,
  thisFlowId: string,
): boolean {
  if (condition.type !== event.type) return false;
  switch (event.type) {
    case "another_flow": {
      if (event.incomingFlowId === thisFlowId) return false;
      const ids = resolveAnotherFlowIds(condition);
      if (ids.length === 0) return true;
      return ids.includes(event.incomingFlowId);
    }
    case "tag_added":
    case "tag_removed": {
      const want = condition.tag_id?.trim();
      if (!want) return false;
      return want === event.tagId;
    }
    case "deal_stage": {
      const want = condition.stage_id?.trim();
      if (!want) return false;
      return want === event.stageId;
    }
    case "keyword":
      return matchesExitKeyword(event.text, condition.keywords ?? [], condition.match_type);
    case "conversation_assigned":
      return true;
  }
}

export function summarizeExitConfig(config: FlowExitConfig): string | null {
  const n = config.conditions.length;
  if (n === 0) return null;
  if (n === 1) {
    const t = config.conditions[0]?.type;
    return t ? `Ends when: ${FLOW_EXIT_CONDITION_LABELS[t]}` : "Has an end condition";
  }
  return `Ends on ${n} conditions`;
}

export function endReasonForExit(event: FlowExitEvent): string {
  return `exit_condition:${event.type}`;
}

/** Normalized list for another_flow matching. Empty = any other flow. */
export function resolveAnotherFlowIds(condition: FlowExitCondition): string[] {
  if (condition.type !== "another_flow") return [];
  if (Array.isArray(condition.flow_ids) && condition.flow_ids.length > 0) {
    return condition.flow_ids.map((id) => id.trim()).filter(Boolean);
  }
  const legacy = condition.flow_id?.trim();
  return legacy ? [legacy] : [];
}

/** Same contains/exact rules as the keyword start trigger, always case-insensitive. */
function matchesExitKeyword(
  text: string,
  keywords: string[],
  matchType: "contains" | "exact" | undefined,
): boolean {
  if (!text || keywords.length === 0) return false;
  const haystack = text.toLowerCase();
  const mode = matchType ?? "contains";
  for (const raw of keywords) {
    if (!raw) continue;
    const needle = raw.toLowerCase();
    if (mode === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}
