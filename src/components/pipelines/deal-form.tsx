"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Contact,
  Deal,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { StageMoveReasonDialog } from "@/components/pipelines/stage-move-reason-dialog";
import { DealConversationPanel } from "@/components/pipelines/deal-conversation-panel";
import {
  appendStageMoveNote,
  resolveDealInsertTitle,
} from "@/lib/deals/display";
import {
  recordDealReceivedEvent,
  recordDealStageMoveEvent,
} from "@/lib/deals/stage-events";
import { buildDealTimeline } from "@/lib/deals/timeline";
import { DealTimeline } from "@/components/pipelines/deal-timeline";
import type { DealStageEvent } from "@/types";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [stageMoveDialogOpen, setStageMoveDialogOpen] = useState(false);
  const [moveReason, setMoveReason] = useState("");
  const [stageEvents, setStageEvents] = useState<DealStageEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [sheetView, setSheetView] = useState<"deal" | "conversation">("deal");
  const [hasConversation, setHasConversation] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setStageMoveDialogOpen(false);
      setMoveReason("");
      setSheetView("deal");
      return;
    }
    setConfirmDelete(false);
    if (deal) {
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setContactId("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      if (!cancelled) {
        setProfiles((profileData ?? []) as Profile[]);
      }

      if (!deal) {
        const { data: contactData } = await supabase
          .from("contacts")
          .select("*")
          .order("name");
        if (!cancelled) {
          setContacts((contactData ?? []) as Contact[]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal, supabase]);

  // Check whether this contact has a conversation (edit flow only).
  useEffect(() => {
    const effectiveContactId = deal?.contact_id ?? contactId;
    if (!open || !deal || !effectiveContactId) {
      setHasConversation(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", effectiveContactId);
      if (!cancelled) {
        setHasConversation((count ?? 0) > 0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, deal, contactId, supabase]);

  useEffect(() => {
    if (!open || !deal?.id) {
      setStageEvents([]);
      setTimelineLoading(false);
      return;
    }

    let cancelled = false;
    setTimelineLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("deal_stage_events")
        .select("*")
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (error) {
        console.error("[deal timeline] load failed:", error.message);
        setStageEvents([]);
      } else {
        setStageEvents((data ?? []) as DealStageEvent[]);
      }
      setTimelineLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, deal?.id, supabase]);

  const timelineItems = useMemo(() => {
    if (!deal) return [];
    return buildDealTimeline(stageEvents, deal, stages);
  }, [deal, stageEvents, stages]);

  async function performSave(finalNotes: string | null) {
    const effectiveStageId = stageId || stages[0]?.id || "";
    const contact =
      deal?.contact ?? contacts.find((c) => c.id === contactId) ?? null;
    const stage = stages.find((s) => s.id === effectiveStageId);
    const resolvedTitle = resolveDealInsertTitle({
      configuredTitle: "",
      contact,
      stageName: stage?.name,
    });

    setSaving(true);

    const payload = {
      title: resolvedTitle,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: effectiveStageId,
      assigned_to: assignedTo || null,
      notes: finalNotes,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
      if (
        accountId &&
        contactId &&
        effectiveStageId &&
        deal.stage_id !== effectiveStageId
      ) {
        void fetch("/api/crm/triggers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger_type: "deal_stage_changed",
            contact_id: contactId,
            stage_id: effectiveStageId,
          }),
        });
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { data: createdDeal, error } = await supabase
        .from("deals")
        .insert({
          ...payload,
          value: 0,
          currency: defaultCurrency,
          expected_close_date: null,
          user_id: user.id,
          account_id: accountId,
          status: "open",
        })
        .select("id, created_at")
        .single();
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
      if (createdDeal) {
        await recordDealReceivedEvent(supabase, {
          dealId: createdDeal.id,
          accountId,
          stageId: effectiveStageId,
          stageName: stage?.name ?? "Unknown",
          userId: user.id,
          createdAt: createdDeal.created_at,
        });
      }
      if (accountId && contactId && effectiveStageId) {
        void fetch("/api/crm/triggers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger_type: "deal_stage_changed",
            contact_id: contactId,
            stage_id: effectiveStageId,
          }),
        });
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleSave() {
    if (!contactId) {
      toast.error("Contact is required");
      return;
    }
    const effectiveStageId = stageId || stages[0]?.id || "";
    if (!effectiveStageId) {
      toast.error("This pipeline has no stages yet");
      return;
    }

    if (deal && deal.stage_id !== effectiveStageId) {
      setStageMoveDialogOpen(true);
      setMoveReason("");
      return;
    }

    await performSave(notes.trim() || null);
  }

  async function handleConfirmStageMove() {
    if (!deal) return;
    const reason = moveReason.trim();
    if (!reason) {
      toast.error("Please enter a reason for the move");
      return;
    }

    const effectiveStageId = stageId || stages[0]?.id || "";
    const fromStage = stages.find((s) => s.id === deal.stage_id);
    const toStage = stages.find((s) => s.id === effectiveStageId);
    const updatedNotes = appendStageMoveNote(
      notes,
      fromStage?.name ?? "Unknown",
      toStage?.name ?? "Unknown",
      reason,
    );

    setStageMoveDialogOpen(false);
    setMoveReason("");

    if (accountId) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await recordDealStageMoveEvent(supabase, {
        dealId: deal.id,
        accountId,
        fromStageId: deal.stage_id,
        toStageId: effectiveStageId,
        fromStageName: fromStage?.name ?? "Unknown",
        toStageName: toStage?.name ?? "Unknown",
        reason,
        userId: session?.user?.id ?? null,
      });
    }

    await performSave(updatedNotes);
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const editingContact = deal?.contact ?? null;
  const editingContactLabel =
    editingContact?.name?.trim() ||
    editingContact?.phone ||
    deal?.title?.trim() ||
    "Unknown contact";

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`bg-popover border-border text-popover-foreground w-full p-0 ${
          sheetView === "conversation" ? "sm:max-w-xl" : "sm:max-w-lg"
        }`}
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            {sheetView === "conversation" && deal?.contact_id ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSheetView("deal")}
                  className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Back to deal"
                >
                  <ArrowLeft className="size-4" />
                </button>
                <SheetTitle className="text-popover-foreground">
                  Conversation
                </SheetTitle>
              </div>
            ) : (
              <SheetTitle className="text-popover-foreground">
                {deal ? t("editDeal") : t("newDeal")}
              </SheetTitle>
            )}
          </SheetHeader>

          {sheetView === "conversation" && deal?.contact_id ? (
            <DealConversationPanel
              contactId={deal.contact_id}
              initialContact={deal.contact ?? null}
              onBack={() => setSheetView("deal")}
            />
          ) : (
            <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {deal ? (
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("contact")}</Label>
                <div className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5">
                  <p className="text-sm font-medium tracking-tight text-foreground">
                    {editingContactLabel}
                  </p>
                  {editingContact?.phone && editingContact?.name && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {editingContact.phone}
                    </p>
                  )}
                </div>
                {hasConversation && deal.contact_id && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSheetView("conversation")}
                    className="border-border bg-card/80 text-foreground hover:bg-muted"
                  >
                    <MessageSquare className="size-3.5" />
                    Open Conversation
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("contact")}</Label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t("selectContact")}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            {deal && (
              <DealTimeline items={timelineItems} loading={timelineLoading} />
            )}

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !contactId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>

    {deal && stageMoveDialogOpen && (
      <StageMoveReasonDialog
        open
        fromStageName={
          stages.find((s) => s.id === deal.stage_id)?.name ?? "Unknown"
        }
        toStageName={
          stages.find((s) => s.id === (stageId || stages[0]?.id))?.name ??
          "Unknown"
        }
        reason={moveReason}
        onReasonChange={setMoveReason}
        onConfirm={() => void handleConfirmStageMove()}
        onCancel={() => {
          setStageMoveDialogOpen(false);
          setMoveReason("");
        }}
        loading={saving}
        confirmLabel="Save changes"
      />
    )}
    </>
  );
}
