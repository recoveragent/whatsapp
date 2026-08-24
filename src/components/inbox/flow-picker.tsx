"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { WhatsAppFlow } from "@/types";
import { Button } from "@/components/ui/button";
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
  ClipboardList,
  Loader2,
} from "lucide-react";
import Link from "next/link";

interface FlowPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (flow: WhatsAppFlow) => void;
}

export function FlowPicker({
  open,
  onOpenChange,
  onSelect,
}: FlowPickerProps) {
  const { accountId } = useAuth();
  const [flows, setFlows] = useState<WhatsAppFlow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!accountId) {
        if (!cancelled) {
          setFlows([]);
          setLoading(false);
        }
        return;
      }

      const supabase = createClient();
      const { data, error } = await supabase
        .from("whatsapp_flows")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch WhatsApp Flows:", error);
        setFlows([]);
      } else {
        setFlows((data as WhatsAppFlow[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
  }

  function pickFlow(flow: WhatsAppFlow) {
    onSelect(flow);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <ClipboardList className="h-4 w-4 text-primary" />
            Send WhatsApp Flow
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Pick a saved Flow form to send. The customer taps the CTA button
            to open it in WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : flows.length === 0 ? (
            <div className="rounded-md border border-border bg-background/50 p-6 text-center">
              <p className="text-sm text-popover-foreground">No saved Flows</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a published Meta Flow in{" "}
                <Link
                  href="/settings?tab=templates"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => handleOpenChange(false)}
                >
                  Settings → Templates
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
                    <p className="truncate text-sm font-medium text-popover-foreground">
                      {f.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {f.flow_id}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {f.body_text}
                    </p>
                    <p className="mt-1 text-[10px] text-primary">
                      CTA: {f.flow_cta}
                    </p>
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
            onClick={() => handleOpenChange(false)}
            className="border-border text-popover-foreground hover:bg-muted"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
