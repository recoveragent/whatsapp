"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SHOPIFY_SHIPMENT_BRANCH_STATUSES,
  SHOPIFY_SHIPMENT_STATUS_LABELS,
  selectedShipmentStatuses,
  shipmentRoutesFromConfig,
  type ShopifyShipmentStatus,
} from "@/lib/flows/trigger-types";
import {
  FULFILLMENT_STATUS_NONE_KEY,
  type FulfillmentStatusStats,
} from "@/lib/shopify/fulfillment-status-stats";

function toggleShipmentStatus(
  config: Record<string, unknown>,
  status: string,
  on: boolean,
): Record<string, unknown> {
  const current = selectedShipmentStatuses(config);
  const next = on
    ? current.includes(status)
      ? current
      : [...current, status]
    : current.filter((x) => x !== status);
  const routes = shipmentRoutesFromConfig(config);
  const pruned = Object.fromEntries(
    Object.entries(routes).filter(([key]) => next.includes(key)),
  );
  return {
    ...config,
    shipment_status: next.length === 1 ? next[0] : "any",
    shipment_statuses: next,
    shipment_routes: pruned,
  };
}

export function FulfillmentStatusInsights({
  triggerConfig,
  onTriggerConfigChange,
}: {
  triggerConfig: Record<string, unknown>;
  onTriggerConfigChange: (config: Record<string, unknown>) => void;
}) {
  const [stats, setStats] = useState<FulfillmentStatusStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/fulfillment-statuses?days=7");
      const json = (await res.json()) as FulfillmentStatusStats & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load fulfillment statuses");
      }
      setStats(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedShipmentStatuses(triggerConfig);
  const maxCount = Math.max(...(stats?.statuses.map((s) => s.count) ?? [1]), 1);
  const noneRow = stats?.statuses.find((s) => s.status === FULFILLMENT_STATUS_NONE_KEY);
  const noneDominant =
    noneRow != null &&
    stats != null &&
    stats.total_events > 0 &&
    noneRow.count / stats.total_events >= 0.5;

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">
            Statuses received (last 7 days)
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            From Shopify{" "}
            <code className="rounded bg-muted px-1">fulfillments/create</code> and{" "}
            <code className="rounded bg-muted px-1">fulfillments/update</code>{" "}
            webhooks — carrier tracking field{" "}
            <code className="rounded bg-muted px-1">shipment_status</code>, not
            whether the order is fulfilled.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading recent fulfillment events…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : stats && stats.total_events === 0 ? (
        <p className="text-xs text-muted-foreground">
          No fulfillment webhooks recorded yet. Events appear here after the next
          fulfillments — leave all statuses unchecked below to send on any fulfill.
        </p>
      ) : stats ? (
        <>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {stats.total_events} webhook event{stats.total_events === 1 ? "" : "s"}{" "}
            in the last {stats.days} days. Click a row to add or remove it from the
            trigger filter above.
          </p>
          <ul className="flex flex-col gap-1.5">
            {stats.statuses.map((row) => {
              const selectable =
                row.status !== FULFILLMENT_STATUS_NONE_KEY &&
                SHOPIFY_SHIPMENT_BRANCH_STATUSES.includes(
                  row.status as (typeof SHOPIFY_SHIPMENT_BRANCH_STATUSES)[number],
                );
              const isOn = selectable && selected.includes(row.status);
              const widthPct = Math.max(4, (row.count / maxCount) * 100);

              return (
                <li key={row.status}>
                  <button
                    type="button"
                    disabled={!selectable}
                    onClick={() => {
                      if (!selectable) return;
                      onTriggerConfigChange(
                        toggleShipmentStatus(triggerConfig, row.status, !isOn),
                      );
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                      !selectable
                        ? "cursor-default border-border/60 bg-muted/20 text-muted-foreground"
                        : isOn
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border bg-background/60 hover:bg-background",
                    )}
                  >
                    <span className="min-w-[8rem] shrink-0 font-medium">
                      {row.label}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            selectable ? "bg-primary/70" : "bg-muted-foreground/40",
                          )}
                          style={{ width: `${widthPct}%` }}
                        />
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    </span>
                    {!selectable ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        leave filters empty
                      </span>
                    ) : isOn ? (
                      <span className="shrink-0 text-[10px] text-primary">On</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {noneDominant ? (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-950 dark:text-amber-100">
              Most fulfillments arrive with{" "}
              <strong>no carrier status</strong>. To message when an order is first
              fulfilled, leave all shipment statuses unchecked — do not select
              &ldquo;Confirmed&rdquo; alone.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                onTriggerConfigChange({
                  ...triggerConfig,
                  shipment_status: "any",
                  shipment_statuses: [],
                  shipment_routes: {},
                })
              }
              className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear all filters (any fulfill)
            </button>
            {stats.statuses
              .filter(
                (row) =>
                  row.status !== FULFILLMENT_STATUS_NONE_KEY &&
                  SHOPIFY_SHIPMENT_BRANCH_STATUSES.includes(
                    row.status as ShopifyShipmentStatus,
                  ),
              )
              .slice(0, 5)
              .map((row) => (
                <button
                  key={`pick-${row.status}`}
                  type="button"
                  onClick={() =>
                    onTriggerConfigChange(
                      toggleShipmentStatus(triggerConfig, row.status, true),
                    )
                  }
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  +{" "}
                  {SHOPIFY_SHIPMENT_STATUS_LABELS[
                    row.status as ShopifyShipmentStatus
                  ] ?? row.label}
                </button>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
