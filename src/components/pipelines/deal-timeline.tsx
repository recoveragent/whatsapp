"use client";

import { format, isToday, isYesterday } from "date-fns";
import { CircleDot, Flag, GitBranch } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DealTimelineItem } from "@/lib/deals/timeline";

function formatTimelineTimestamp(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  if (isYesterday(date)) return `Yesterday, ${format(date, "h:mm a")}`;
  return format(date, "d MMM yyyy, h:mm a");
}

function StageDot({ color }: { color?: string }) {
  return (
    <span
      className="mt-1 inline-flex size-2.5 shrink-0 rounded-full ring-2 ring-background"
      style={{ backgroundColor: color ?? "var(--primary)" }}
    />
  );
}

function TimelineRow({
  item,
  isLast,
}: {
  item: DealTimelineItem;
  isLast: boolean;
}) {
  if (item.kind === "received") {
    return (
      <li className="relative flex gap-3 pb-4">
        {!isLast && (
          <span
            aria-hidden
            className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-border/80"
          />
        )}
        <StageDot color={item.stageColor} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-medium tracking-tight text-foreground">
              Lead received
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              {item.stageName}
            </span>
          </div>
          {formatTimelineTimestamp(item.created_at) && (
            <p className="text-xs text-muted-foreground">
              {formatTimelineTimestamp(item.created_at)}
            </p>
          )}
        </div>
      </li>
    );
  }

  if (item.kind === "stage_move") {
    return (
      <li className="relative flex gap-3 pb-4">
        {!isLast && (
          <span
            aria-hidden
            className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-border/80"
          />
        )}
        <GitBranch className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tracking-tight">
            <span className="font-medium text-foreground">{item.fromStageName}</span>
            <span className="text-muted-foreground">→</span>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-foreground"
              style={{
                backgroundColor: item.toStageColor
                  ? `${item.toStageColor}22`
                  : "var(--muted)",
              }}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: item.toStageColor ?? "var(--primary)" }}
              />
              {item.toStageName}
            </span>
          </div>
          {item.reason && (
            <p className="rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
              {item.reason}
            </p>
          )}
          {formatTimelineTimestamp(item.created_at) && (
            <p className="text-xs text-muted-foreground">
              {formatTimelineTimestamp(item.created_at)}
            </p>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="relative flex gap-3 pb-1">
      <Flag className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-sm font-medium tracking-tight text-foreground">
            Current stage
          </p>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-foreground"
            style={{
              backgroundColor: item.stageColor
                ? `${item.stageColor}22`
                : "var(--muted)",
            }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: item.stageColor ?? "var(--primary)" }}
            />
            {item.stageName}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {formatTimelineTimestamp(item.since) ?? "Now"}
        </p>
      </div>
    </li>
  );
}

export function DealTimeline({
  items,
  loading,
  className,
}: {
  items: DealTimelineItem[];
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border/70 bg-card/50 p-4 text-sm text-muted-foreground",
          className,
        )}
      >
        Loading timeline…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/70 bg-card/30 px-4 py-6 text-center",
          className,
        )}
      >
        <CircleDot className="mx-auto mb-2 size-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No stage history yet.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card/50 p-4 backdrop-blur-sm",
        className,
      )}
    >
      <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Timeline
      </p>
      <ol className="m-0 list-none p-0">
        {items.map((item, index) => (
          <TimelineRow
            key={`${item.kind}-${index}`}
            item={item}
            isLast={index === items.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}
