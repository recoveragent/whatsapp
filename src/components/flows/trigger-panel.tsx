"use client";

import { useState } from "react";
import { Check } from "lucide-react";
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
  flowTriggersForBrand,
  isShopifyFulfillmentFlowTrigger,
  isShopifyOrderFlowTrigger,
  defaultShopifyTriggerConfig,
  SHOPIFY_PAYMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUS_LABELS,
  SHOPIFY_SHIPMENT_BRANCH_STATUSES,
  SHOPIFY_SHIPMENT_STATUS_LABELS,
  selectedShipmentStatuses,
  shipmentHandleId,
  shipmentRoutesFromConfig,
  type FlowTriggerType,
  type ShopifyPaymentStatus,
  type ShopifyShipmentStatus,
} from "@/lib/flows/trigger-types";
import {
  defaultFlowWebhookConfig,
  type FlowWebhookTriggerConfig,
} from "@/lib/flows/webhook-config";
import { defaultGoogleSheetRowConfig } from "@/lib/google-sheets/trigger-config";
import { FlowWebhookTriggerPanel } from "./webhook-trigger-panel";
import { FlowGoogleSheetTriggerPanel } from "./google-sheet-trigger-panel";
import { IssueLine } from "./validation-panel";
import { ExitConditionsPanel } from "./exit-panel";
import type { BuilderState } from "./flow-editor-state";
import type { GoogleSheetRowTriggerConfig } from "@/lib/google-sheets/trigger-config";
import { parseExitConfig } from "@/lib/flows/exit-conditions";
import { NEXT_STEP_LABEL } from "@/lib/flows/reply-timeout";
import { useAuth } from "@/hooks/use-auth";

/** Stable React-Flow id for the virtual trigger node on the canvas. */
export const TRIGGER_NODE_ID = "__flow_trigger__";

export function triggerOutgoingSlots(
  triggerType: FlowTriggerType,
  config: Record<string, unknown>,
): Array<{ id: string; label: string }> {
  if (isShopifyFulfillmentFlowTrigger(triggerType)) {
    const selected = selectedShipmentStatuses(config);
    if (selected.length > 0) {
      return selected.map((status) => ({
        id: shipmentHandleId(status),
        label:
          SHOPIFY_SHIPMENT_STATUS_LABELS[status as ShopifyShipmentStatus] ??
          status,
      }));
    }
  }
  return [{ id: "next", label: NEXT_STEP_LABEL }];
}

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
    case "google_sheet_row": {
      const sources = Array.isArray(triggerConfig.sources)
        ? (triggerConfig.sources as Array<{ label?: string; sheet_name?: string }>)
        : [];
      if (sources.length > 1) {
        return `${sources.length} Google Sheets`;
      }
      const one = sources[0];
      const sheet =
        (typeof one?.label === "string" && one.label.trim()) ||
        (typeof one?.sheet_name === "string" && one.sheet_name) ||
        (typeof triggerConfig.sheet_name === "string" ? triggerConfig.sheet_name : "");
      return sheet ? `Sheet · ${sheet}` : "Map Google Sheet columns";
    }
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
        const bits = [base];
        if (ps && ps !== "any") bits.push(SHOPIFY_PAYMENT_STATUS_LABELS[ps]);
        const shipments = selectedShipmentStatuses(triggerConfig);
        if (shipments.length > 0) {
          bits.push(
            shipments
              .map(
                (s) =>
                  SHOPIFY_SHIPMENT_STATUS_LABELS[s as ShopifyShipmentStatus] ??
                  s,
              )
              .join(", "),
          );
        }
        return bits.join(" · ");
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
  const { brandCategory } = useAuth();
  const triggerOptions = flowTriggersForBrand(brandCategory, state.trigger_type);
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
                      : v === "google_sheet_row"
                        ? (defaultGoogleSheetRowConfig() as unknown as Record<
                            string,
                            unknown
                          >)
                      : v === "tag_added"
                        ? { tag_id: "" }
                        : v === "time_based"
                          ? { schedule: "", tag_id: "" }
                          : v && isShopifyOrderFlowTrigger(v)
                            ? defaultShopifyTriggerConfig(v)
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
              {triggerOptions.map((t) => (
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
        {state.trigger_type === "google_sheet_row" && (
          <FlowGoogleSheetTriggerPanel
            config={state.trigger_config as unknown as GoogleSheetRowTriggerConfig}
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
        {isShopifyFulfillmentFlowTrigger(state.trigger_type) && (
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-muted-foreground">
              Shipment status
            </label>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {SHOPIFY_SHIPMENT_BRANCH_STATUSES.map((status) => {
                const selected = selectedShipmentStatuses(state.trigger_config);
                const on = selected.includes(status);
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() =>
                      setState((s) => {
                        const current = selectedShipmentStatuses(s.trigger_config);
                        const next = on
                          ? current.filter((x) => x !== status)
                          : [...current, status];
                        const routes = shipmentRoutesFromConfig(s.trigger_config);
                        const pruned = Object.fromEntries(
                          Object.entries(routes).filter(([key]) =>
                            next.includes(key),
                          ),
                        );
                        return {
                          ...s,
                          trigger_config: {
                            ...s.trigger_config,
                            shipment_status:
                              next.length === 1 ? next[0] : "any",
                            shipment_statuses: next,
                            shipment_routes: pruned,
                          },
                        };
                      })
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                      on
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    {SHOPIFY_SHIPMENT_STATUS_LABELS[status]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Leave all unchecked to run on any fulfillment update. Check more
              than one to get a handle per status on the trigger — drag each
              to its node.
            </p>
          </div>
        )}
      </div>
      {triggerIssues.filter((i) => !i.field?.startsWith("exit_config")).length >
        0 && (
        <div className="mt-3 flex flex-col gap-1">
          {triggerIssues
            .filter((i) => !i.field?.startsWith("exit_config"))
            .map((i, ix) => (
              <IssueLine key={ix} issue={i} />
            ))}
        </div>
      )}
      <ExitConditionsPanel
        flowId={flowId}
        config={parseExitConfig(state.exit_config)}
        onChange={(exit_config) => setState((s) => ({ ...s, exit_config }))}
        issues={triggerIssues.filter((i) => i.field?.startsWith("exit_config"))}
      />
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
