"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, Flag, X } from "lucide-react";
import {
  resolveDealCardContactFields,
  resolveDealCardLastNoteLine,
} from "@/lib/deals/display";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const { name, phone, company } = resolveDealCardContactFields(deal);
  const assigneeLabel = deal.assignee?.full_name || null;
  const lastNote = resolveDealCardLastNoteLine(deal.notes);
  const duplicateCount = deal.contact?.lead_duplicate_count ?? 0;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {duplicateCount > 0 && (
        <span
          className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-400"
          title={`${duplicateCount} duplicate lead submission${duplicateCount !== 1 ? "s" : ""}`}
        >
          <Flag className="h-3 w-3" aria-hidden />
          {duplicateCount}
        </span>
      )}
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h4 className="text-sm font-semibold leading-snug text-foreground break-words">
              {name}
            </h4>
            {phone && (
              <p className="truncate text-xs text-muted-foreground">{phone}</p>
            )}
            {company && (
              <p className="truncate text-xs text-muted-foreground">{company}</p>
            )}
          </div>
        </div>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {(deal.expected_close_date || assigneeLabel) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {deal.expected_close_date ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatDate(deal.expected_close_date)}
            </span>
          ) : (
            <span />
          )}
          {assigneeLabel && (
            <span
              title={assigneeLabel}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(assigneeLabel)}
            </span>
          )}
        </div>
      )}

      {lastNote && (
        <p
          className="mt-2 truncate border-t border-border/50 pt-2 text-[11px] italic text-muted-foreground"
          title={lastNote}
        >
          {lastNote}
        </p>
      )}
    </button>
  );
}
