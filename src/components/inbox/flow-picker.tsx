"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronRight,
  Workflow,
  Loader2,
} from "lucide-react";
import Link from "next/link";

export interface ManualFlowOption {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: string;
  trigger_config: Record<string, unknown>;
}

interface FlowPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (flow: ManualFlowOption) => void;
}

function describeTrigger(flow: ManualFlowOption): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return "Keyword trigger";
    return `Keyword: ${keywords.slice(0, 3).join(", ")}${keywords.length > 3 ? "…" : ""}`;
  }
  if (flow.trigger_type === "first_inbound_message") {
    return "First inbound message";
  }
  if (flow.trigger_type === "manual") {
    return "Manual trigger";
  }
  return flow.trigger_type.replace(/_/g, " ");
}

export function FlowPicker({
  open,
  onOpenChange,
  onSelect,
}: FlowPickerProps) {
  const [flows, setFlows] = useState<ManualFlowOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/flows");
        const json = (await res.json()) as { flows?: ManualFlowOption[] };
        if (cancelled) return;
        if (!res.ok) {
          setFlows([]);
        } else {
          setFlows(
            (json.flows ?? []).filter((f) => f.status === "active"),
          );
        }
      } catch {
        if (!cancelled) setFlows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function pickFlow(flow: ManualFlowOption) {
    onSelect(flow);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <Workflow className="h-4 w-4 text-primary" />
            Start Flow
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Run one of your active flows for this contact now — the normal
            trigger (keyword, webhook, etc.) is skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : flows.length === 0 ? (
            <div className="rounded-md border border-border bg-background/50 p-6 text-center">
              <p className="text-sm text-popover-foreground">No active flows</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create and activate a flow in{" "}
                <Link
                  href="/flows"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  Flows
                </Link>
                .
              </p>
            </div>
          ) : (
            flows.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => pickFlow(f)}
                className="w-full rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-popover-foreground">
                        {f.name}
                      </p>
                      <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                        Active
                      </Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {describeTrigger(f)}
                    </p>
                    {(f.description?.trim() || describeTrigger(f)) && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {f.description?.trim() || describeTrigger(f)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
