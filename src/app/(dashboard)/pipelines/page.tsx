"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { StageMoveReasonDialog } from "@/components/pipelines/stage-move-reason-dialog";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, Search, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";
import { PageHeader } from "@/components/layout/page-header";
import { useRouter } from "next/navigation";
import {
  filterPipelineDeals,
  hasActivePipelineDealFilters,
  type PipelineDealDateField,
} from "@/lib/deals/filter";
import { appendStageMoveNote } from "@/lib/deals/display";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
];

export default function PipelinesPage() {
  const router = useRouter();
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId, isLeadGenBrand, profileLoading } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateField, setDateField] = useState<PipelineDealDateField>("received");

  // Pending drag-move: reason required before stage change is persisted.
  const [pendingMove, setPendingMove] = useState<{
    dealId: string;
    fromStageId: string;
    toStageId: string;
  } | null>(null);
  const [moveReason, setMoveReason] = useState("");
  const [movingDeal, setMovingDeal] = useState(false);

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Sales Pipeline" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      void queueMicrotask(() => {
        setStages([]);
        setDeals([]);
      });
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  useEffect(() => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
  }, [selectedPipelineId]);

  const filteredDeals = useMemo(
    () =>
      filterPipelineDeals(deals, {
        search,
        dateFrom,
        dateTo,
        dateField,
      }),
    [deals, search, dateFrom, dateTo, dateField],
  );

  const filtersActive = hasActivePipelineDealFilters({
    search,
    dateFrom,
    dateTo,
  });

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoveRequest = useCallback(
    (dealId: string, newStageId: string) => {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage_id === newStageId) return;
      setPendingMove({
        dealId,
        fromStageId: deal.stage_id,
        toStageId: newStageId,
      });
      setMoveReason("");
    },
    [deals],
  );

  const handleCancelDealMove = useCallback(() => {
    setPendingMove(null);
    setMoveReason("");
  }, []);

  const handleConfirmDealMove = useCallback(async () => {
    if (!pendingMove) return;
    const reason = moveReason.trim();
    if (!reason) {
      toast.error("Please enter a reason for the move");
      return;
    }

    const { dealId, fromStageId, toStageId } = pendingMove;
    const moved = deals.find((d) => d.id === dealId);
    if (!moved) return;

    const fromStage = stages.find((s) => s.id === fromStageId);
    const toStage = stages.find((s) => s.id === toStageId);
    const updatedNotes = appendStageMoveNote(
      moved.notes,
      fromStage?.name ?? "Unknown",
      toStage?.name ?? "Unknown",
      reason,
    );

    setMovingDeal(true);
    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId
          ? { ...d, stage_id: toStageId, notes: updatedNotes }
          : d,
      ),
    );

    const { error } = await supabase
      .from("deals")
      .update({ stage_id: toStageId, notes: updatedNotes })
      .eq("id", dealId);

    setMovingDeal(false);

    if (error) {
      toast.error("Failed to move deal");
      refreshDeals();
    } else {
      if (accountId && moved.contact_id) {
        void fetch("/api/crm/triggers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger_type: "deal_stage_changed",
            contact_id: moved.contact_id,
            stage_id: toStageId,
          }),
        });
      }
      setPendingMove(null);
      setMoveReason("");
    }
  }, [
    pendingMove,
    moveReason,
    deals,
    stages,
    supabase,
    refreshDeals,
    accountId,
  ]);

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  useEffect(() => {
    if (!profileLoading && !isLeadGenBrand) {
      router.replace("/dashboard");
    }
  }, [profileLoading, isLeadGenBrand, router]);

  if (profileLoading || !isLeadGenBrand) {
    return null;
  }

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error("Your profile is not linked to an account.");
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error("Failed to create pipeline");
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success("Pipeline created");
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Pipelines"
        subtitle="Tap a stage to drill into deals. Cards expand in place."
      />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Select Pipeline"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  No pipelines yet
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Manage Pipelines
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Pipeline
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Deal
          </GatedButton>
        </div>
      </div>

      {pipelines.length > 0 && selectedPipelineId && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or company..."
                className="border-border bg-card pl-8 text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex rounded-lg border border-border bg-card p-0.5"
                role="group"
                aria-label="Date filter type"
              >
                {(
                  [
                    ["received", "Received"],
                    ["updated", "Updated"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDateField(value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      dateField === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-36 border-border bg-card text-foreground"
                aria-label={`From date (${dateField})`}
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-36 border-border bg-card text-foreground"
                aria-label={`To date (${dateField})`}
              />
              {filtersActive && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>

          {filtersActive && (
            <p className="text-xs text-muted-foreground">
              Showing {filteredDeals.length} of {deals.length} deals
            </p>
          )}
        </div>
      )}

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            No pipelines yet
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a pipeline to start tracking deals
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Create Pipeline
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={filteredDeals} />
          {filtersActive && filteredDeals.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
              <Search className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium text-foreground">
                No deals match your filters
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Try a different search term or date range.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  setDateFrom("");
                  setDateTo("");
                }}
                className="mt-4 border-border text-muted-foreground hover:bg-muted"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <PipelineBoard
              stages={stages}
              deals={filteredDeals}
              onDealMoveRequest={handleDealMoveRequest}
              onAddDeal={handleAddDeal}
              onEditDeal={handleEditDeal}
            />
          )}
        </>
      )}

      {/* Move reason dialog — shown after drag-drop between stages */}
      {pendingMove && (
        <StageMoveReasonDialog
          open
          fromStageName={
            stages.find((s) => s.id === pendingMove.fromStageId)?.name ??
            "Unknown"
          }
          toStageName={
            stages.find((s) => s.id === pendingMove.toStageId)?.name ??
            "Unknown"
          }
          reason={moveReason}
          onReasonChange={setMoveReason}
          onConfirm={() => void handleConfirmDealMove()}
          onCancel={handleCancelDealMove}
          loading={movingDeal}
        />
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">New Pipeline</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">Pipeline Name</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="e.g., Enterprise Sales"
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Default stages (New Lead → Won) will be created automatically.
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? "Creating..." : "Create Pipeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
