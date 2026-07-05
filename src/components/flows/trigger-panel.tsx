"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ValidationIssue } from "@/lib/flows/validate";
import {
  FLOW_TRIGGER_LABELS,
  FLOW_TRIGGER_TYPES,
  isShopifyOrderFlowTrigger,
  SHOPIFY_PAYMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUS_LABELS,
  type FlowTriggerType,
  type ShopifyPaymentStatus,
} from "@/lib/flows/trigger-types";
import {
  defaultFlowWebhookConfig,
  type FlowWebhookTriggerConfig,
} from "@/lib/flows/webhook-config";
import { FlowWebhookTriggerPanel } from "./webhook-trigger-panel";
import { IssueLine } from "./validation-panel";
import type { BuilderState } from "./flow-editor-state";

/** Stable React-Flow id for the virtual trigger node on the canvas. */
export const TRIGGER_NODE_ID = "__flow_trigger__";

export function summarizeTrigger(
  triggerType: FlowTriggerType,
  triggerConfig: Record<string, unknown>,
): string {
  switch (triggerType) {
    case "keyword": {
      const kws = Array.isArray(triggerConfig.keywords)
        ? (triggerConfig.keywords as string[])
        : [];
      return kws.length > 0 ? kws.join(", ") : "No keywords set";
    }
    case "webhook_received":
      return "External webhook POST";
    case "tag_added":
      return typeof triggerConfig.tag_id === "string" && triggerConfig.tag_id
        ? `Tag ${triggerConfig.tag_id.slice(0, 8)}…`
        : "Pick a tag";
    case "time_based":
      return typeof triggerConfig.schedule === "string" && triggerConfig.schedule
        ? `Daily at ${triggerConfig.schedule}`
        : "Set schedule";
    case "first_inbound_message":
      return "Customer's first message";
    case "new_message_received":
      return "Any new message";
    case "manual":
      return "Manual start only";
    case "conversation_assigned":
      return "When conversation is assigned";
    default:
      if (isShopifyOrderFlowTrigger(triggerType)) {
        const ps = triggerConfig.payment_status as ShopifyPaymentStatus | undefined;
        const base = FLOW_TRIGGER_LABELS[triggerType] ?? triggerType;
        if (ps && ps !== "any") {
          return `${base} · ${SHOPIFY_PAYMENT_STATUS_LABELS[ps]}`;
        }
        return base;
      }
      return FLOW_TRIGGER_LABELS[triggerType] ?? triggerType;
  }
}

function KeywordsInput({
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
      placeholder="support, help, hi"
      className="bg-muted"
    />
  );
}

export function TriggerPanel({
  flowId,
  state,
  setState,
  triggerIssues,
  /** When true, skip the outer section chrome (used inside canvas sheet). */
  embedded = false,
}: {
  flowId: string;
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  triggerIssues: ValidationIssue[];
  embedded?: boolean;
}) {
  const body = (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className={cn(embedded && "md:col-span-2")}>
          <label className="mb-1 block text-xs text-muted-foreground">When…</label>
          <Select
            value={state.trigger_type}
            onValueChange={(v) =>
              setState((s) => ({
                ...s,
                trigger_type: v as BuilderState["trigger_type"],
                trigger_config:
                  v === "keyword"
                    ? { keywords: [] }
                    : v === "webhook_received"
                      ? (defaultFlowWebhookConfig() as unknown as Record<string, unknown>)
                      : v === "tag_added"
                        ? { tag_id: "" }
                        : v === "time_based"
                          ? { schedule: "", tag_id: "" }
                          : v && isShopifyOrderFlowTrigger(v)
                            ? { payment_status: "any" }
                            : {},
              }))
            }
          >
            <SelectTrigger className="h-auto min-h-8 w-full bg-muted [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:whitespace-normal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              alignItemWithTrigger={false}
              className="min-w-[20rem] w-max max-w-[min(calc(100vw-2rem),24rem)]"
            >
              {FLOW_TRIGGER_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="[&_span]:whitespace-normal">
                  {FLOW_TRIGGER_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {state.trigger_type === "keyword" && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Keywords (comma-separated)
            </label>
            <KeywordsInput
              keywords={
                Array.isArray(state.trigger_config.keywords)
                  ? (state.trigger_config.keywords as string[])
                  : []
              }
              onChange={(keywords) =>
                setState((s) => ({
                  ...s,
                  trigger_config: { ...s.trigger_config, keywords },
                }))
              }
            />
          </div>
        )}
        {state.trigger_type === "tag_added" && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Tag id</label>
            <Input
              value={(state.trigger_config.tag_id as string) ?? ""}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  trigger_config: { ...s.trigger_config, tag_id: e.target.value },
                }))
              }
              className="bg-muted"
              placeholder="Tag UUID"
            />
          </div>
        )}
        {state.trigger_type === "time_based" && (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Schedule (HH:mm)
              </label>
              <Input
                value={(state.trigger_config.schedule as string) ?? ""}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    trigger_config: { ...s.trigger_config, schedule: e.target.value },
                  }))
                }
                className="bg-muted"
                placeholder="09:00"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Audience tag id
              </label>
              <Input
                value={(state.trigger_config.tag_id as string) ?? ""}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    trigger_config: { ...s.trigger_config, tag_id: e.target.value },
                  }))
                }
                className="bg-muted"
                placeholder="Tag UUID — flow runs for each contact with this tag"
              />
            </div>
          </>
        )}
        {state.trigger_type === "webhook_received" && (
          <FlowWebhookTriggerPanel
            flowId={flowId}
            config={state.trigger_config as unknown as FlowWebhookTriggerConfig}
            onChange={(c) => setState((s) => ({ ...s, trigger_config: c }))}
          />
        )}
        {isShopifyOrderFlowTrigger(state.trigger_type) && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Payment status
            </label>
            <Select
              value={
                (state.trigger_config.payment_status as ShopifyPaymentStatus) ?? "any"
              }
              onValueChange={(v) =>
                setState((s) => ({
                  ...s,
                  trigger_config: {
                    ...s.trigger_config,
                    payment_status: v as ShopifyPaymentStatus,
                  },
                }))
              }
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOPIFY_PAYMENT_STATUSES.map((ps) => (
                  <SelectItem key={ps} value={ps}>
                    {SHOPIFY_PAYMENT_STATUS_LABELS[ps]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Only run this flow when the order matches this payment status. Use a
              Condition node to branch different actions per status.
            </p>
          </div>
        )}
      </div>
      {triggerIssues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {triggerIssues.map((i, ix) => (
            <IssueLine key={ix} issue={i} />
          ))}
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Trigger</h2>
      {body}
    </section>
  );
}
