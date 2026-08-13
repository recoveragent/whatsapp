"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  FLOW_EXIT_CONDITION_LABELS,
  FLOW_EXIT_CONDITION_TYPES,
  emptyExitCondition,
  type FlowExitCondition,
  type FlowExitConditionType,
  type FlowExitConfig,
} from "@/lib/flows/exit-conditions";
import type { ValidationIssue } from "@/lib/flows/validate";
import { IssueLine } from "./validation-panel";

const ANY_FLOW = "__any__";

interface TagRow {
  id: string;
  name: string;
  color: string | null;
}

interface PipelineRow {
  id: string;
  name: string;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
}

interface FlowOption {
  id: string;
  name: string;
}

export function ExitConditionsPanel({
  flowId,
  config,
  onChange,
  issues,
}: {
  flowId: string;
  config: FlowExitConfig;
  onChange: (next: FlowExitConfig) => void;
  issues: ValidationIssue[];
}) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const [tagsRes, pipesRes, stagesRes, flowsRes] = await Promise.all([
        supabase.from("tags").select("id, name, color").order("name"),
        supabase.from("pipelines").select("id, name").order("name"),
        supabase
          .from("pipeline_stages")
          .select("id, pipeline_id, name")
          .order("position"),
        fetch("/api/flows", { cache: "no-store" })
          .then(async (res) => {
            if (!res.ok) return [] as FlowOption[];
            const json = (await res.json()) as {
              flows?: Array<{ id: string; name: string }>;
            };
            return json.flows ?? [];
          })
          .catch(() => [] as FlowOption[]),
      ]);
      if (cancelled) return;
      setTags((tagsRes.data as TagRow[] | null) ?? []);
      setPipelines((pipesRes.data as PipelineRow[] | null) ?? []);
      setStages((stagesRes.data as StageRow[] | null) ?? []);
      setFlows(flowsRes.filter((f) => f.id !== flowId));
    })();
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  function patchCondition(id: string, patch: Partial<FlowExitCondition>) {
    onChange({
      conditions: config.conditions.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }

  function changeType(id: string, type: FlowExitConditionType) {
    const fresh = emptyExitCondition(type);
    onChange({
      conditions: config.conditions.map((c) =>
        c.id === id ? { ...fresh, id: c.id } : c,
      ),
    });
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            End this flow when…
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Optional. Stops an in-progress run if any of these happen.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() =>
            onChange({
              conditions: [
                ...config.conditions,
                emptyExitCondition("another_flow"),
              ],
            })
          }
        >
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {config.conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No end conditions. The run continues until an End / Handoff node,
          timeout, or an agent reply.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {config.conditions.map((c) => (
            <ConditionRow
              key={c.id}
              condition={c}
              tags={tags}
              pipelines={pipelines}
              stages={stages}
              flows={flows}
              onType={(t) => changeType(c.id, t)}
              onPatch={(patch) => patchCondition(c.id, patch)}
              onRemove={() =>
                onChange({
                  conditions: config.conditions.filter((x) => x.id !== c.id),
                })
              }
            />
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {issues.map((i, ix) => (
            <IssueLine key={ix} issue={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionRow({
  condition,
  tags,
  pipelines,
  stages,
  flows,
  onType,
  onPatch,
  onRemove,
}: {
  condition: FlowExitCondition;
  tags: TagRow[];
  pipelines: PipelineRow[];
  stages: StageRow[];
  flows: FlowOption[];
  onType: (t: FlowExitConditionType) => void;
  onPatch: (patch: Partial<FlowExitCondition>) => void;
  onRemove: () => void;
}) {
  const stagesForPipeline = condition.pipeline_id
    ? stages.filter((s) => s.pipeline_id === condition.pipeline_id)
    : stages;

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Select
          value={condition.type}
          onValueChange={(v) => {
            if (v) onType(v as FlowExitConditionType);
          }}
        >
          <SelectTrigger className="h-auto min-h-8 w-full bg-background [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:whitespace-normal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FLOW_EXIT_CONDITION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FLOW_EXIT_CONDITION_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remove end condition"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {condition.type === "another_flow" && (
        <div className="mt-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            Which flow
          </label>
          <Select
            value={condition.flow_id?.trim() || ANY_FLOW}
            onValueChange={(v) => {
              if (!v) return;
              onPatch({ flow_id: v === ANY_FLOW ? "" : v });
            }}
          >
            <SelectTrigger className="bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_FLOW}>Any other flow</SelectItem>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
              {condition.flow_id &&
                !flows.some((f) => f.id === condition.flow_id) && (
                  <SelectItem value={condition.flow_id}>
                    Unknown flow
                  </SelectItem>
                )}
            </SelectContent>
          </Select>
        </div>
      )}

      {(condition.type === "tag_added" || condition.type === "tag_removed") && (
        <div className="mt-2">
          <label className="mb-1 block text-xs text-muted-foreground">Tag</label>
          {tags.length === 0 ? (
            <Input
              value={condition.tag_id ?? ""}
              onChange={(e) => onPatch({ tag_id: e.target.value })}
              className="bg-background"
              placeholder="Tag UUID"
            />
          ) : (
            <Select
              value={condition.tag_id || undefined}
              onValueChange={(v) => {
                if (v) onPatch({ tag_id: v });
              }}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select a tag…" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
                {condition.tag_id &&
                  !tags.some((t) => t.id === condition.tag_id) && (
                    <SelectItem value={condition.tag_id}>
                      Unknown tag
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {condition.type === "deal_stage" && (
        <div className="mt-2 grid grid-cols-1 gap-2">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Pipeline
            </label>
            <Select
              value={condition.pipeline_id || undefined}
              onValueChange={(v) => {
                if (v) onPatch({ pipeline_id: v, stage_id: "" });
              }}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select a pipeline…" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Stage
            </label>
            <Select
              value={condition.stage_id || undefined}
              onValueChange={(v) => {
                if (v) onPatch({ stage_id: v });
              }}
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select a stage…" />
              </SelectTrigger>
              <SelectContent>
                {stagesForPipeline.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
                {condition.stage_id &&
                  !stagesForPipeline.some((s) => s.id === condition.stage_id) && (
                    <SelectItem value={condition.stage_id}>
                      Unknown stage
                    </SelectItem>
                  )}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {condition.type === "keyword" && (
        <div className="mt-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            Keywords (comma-separated)
          </label>
          <KeywordDraftInput
            keywords={condition.keywords ?? []}
            onChange={(keywords) => onPatch({ keywords })}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Case-insensitive. Ends the run if the customer sends one of these.
          </p>
        </div>
      )}
    </div>
  );
}

function KeywordDraftInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
}) {
  const [draft, setDraft] = useState(keywords.join(", "));

  function commit() {
    const parsed = draft
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    setDraft(parsed.join(", "));
    onChange(parsed);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className="bg-background"
      placeholder="stop, unsubscribe"
    />
  );
}
