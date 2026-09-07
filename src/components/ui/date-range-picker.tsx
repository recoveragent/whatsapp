"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { localDayKey } from "@/lib/dashboard/date-utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function parseIsoDate(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatRangeLabel(from: string, to: string): string {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate && !toDate) return "";
  if (fromDate && !toDate) return format(fromDate, "d MMM yyyy");
  if (!fromDate && toDate) return format(toDate, "d MMM yyyy");
  if (fromDate && toDate) {
    if (isSameDay(fromDate, toDate)) return format(fromDate, "d MMM yyyy");
    if (fromDate.getFullYear() === toDate.getFullYear()) {
      return `${format(fromDate, "d MMM")} – ${format(toDate, "d MMM yyyy")}`;
    }
    return `${format(fromDate, "d MMM yyyy")} – ${format(toDate, "d MMM yyyy")}`;
  }
  return "";
}

type Preset = {
  label: string;
  getRange: () => { from: string; to: string };
};

const PRESETS: Preset[] = [
  {
    label: "Today",
    getRange: () => {
      const today = localDayKey(new Date());
      return { from: today, to: today };
    },
  },
  {
    label: "Last 7 days",
    getRange: () => ({
      from: localDayKey(subDays(new Date(), 6)),
      to: localDayKey(new Date()),
    }),
  },
  {
    label: "Last 30 days",
    getRange: () => ({
      from: localDayKey(subDays(new Date(), 29)),
      to: localDayKey(new Date()),
    }),
  },
  {
    label: "This month",
    getRange: () => {
      const now = new Date();
      return {
        from: localDayKey(startOfMonth(now)),
        to: localDayKey(endOfMonth(now)),
      };
    },
  },
];

export type DateRangePickerProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
  "aria-label"?: string;
};

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  placeholder = "Select dates",
  className,
  align = "start",
  "aria-label": ariaLabel = "Date range",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState(() => {
    const anchor = parseIsoDate(from) ?? parseIsoDate(to) ?? new Date();
    return startOfMonth(anchor);
  });
  const [draftFrom, setDraftFrom] = React.useState(from);
  const [draftTo, setDraftTo] = React.useState(to);
  const [selectingEnd, setSelectingEnd] = React.useState(false);
  const [hoverDate, setHoverDate] = React.useState<Date | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraftFrom(from);
    setDraftTo(to);
    setSelectingEnd(Boolean(from && !to));
    const anchor = parseIsoDate(from) ?? parseIsoDate(to) ?? new Date();
    setViewMonth(startOfMonth(anchor));
    setHoverDate(null);
  }, [open, from, to]);

  const label = formatRangeLabel(from, to);
  const hasValue = Boolean(from || to);

  function applyRange(nextFrom: string, nextTo: string) {
    onFromChange(nextFrom);
    onToChange(nextTo);
  }

  function clearRange() {
    applyRange("", "");
    setDraftFrom("");
    setDraftTo("");
    setSelectingEnd(false);
    setHoverDate(null);
  }

  function handleDayClick(day: Date) {
    const iso = localDayKey(day);

    if (!selectingEnd || !draftFrom) {
      setDraftFrom(iso);
      setDraftTo("");
      setSelectingEnd(true);
      return;
    }

    const start = parseIsoDate(draftFrom);
    if (!start) return;

    if (isBefore(day, start)) {
      applyRange(iso, localDayKey(start));
    } else {
      applyRange(draftFrom, iso);
    }
    setDraftTo(isBefore(day, start) ? localDayKey(start) : iso);
    setSelectingEnd(false);
    setHoverDate(null);
    setOpen(false);
  }

  function handlePreset(preset: Preset) {
    const range = preset.getRange();
    setDraftFrom(range.from);
    setDraftTo(range.to);
    applyRange(range.from, range.to);
    setSelectingEnd(false);
    setOpen(false);
  }

  const rangeStart = parseIsoDate(draftFrom);
  let rangeEndDate = parseIsoDate(draftTo);
  if (!rangeEndDate && selectingEnd && hoverDate && rangeStart) {
    rangeEndDate = isBefore(hoverDate, rangeStart) ? rangeStart : hoverDate;
  }
  const effectiveStart =
    rangeStart && rangeEndDate && isAfter(rangeStart, rangeEndDate)
      ? rangeEndDate
      : rangeStart;
  const effectiveEnd =
    rangeStart && rangeEndDate && isAfter(rangeStart, rangeEndDate)
      ? rangeStart
      : rangeEndDate;

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={ariaLabel}
            className={cn(
              "h-9 gap-2 rounded-xl border-border/80 bg-card/80 px-3 font-normal shadow-sm backdrop-blur-sm transition-[transform,background-color,border-color,box-shadow] duration-100 active:scale-[0.98] motion-reduce:active:scale-100",
              hasValue && "text-foreground",
              !hasValue && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <Calendar className="size-3.5 shrink-0 opacity-70" />
        <span className="max-w-[220px] truncate text-sm tracking-tight">
          {label || placeholder}
        </span>
        {hasValue && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date range"
            className="ml-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90 motion-reduce:active:scale-100"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              clearRange();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                clearRange();
              }
            }}
          >
            <X className="size-3" />
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent
        align={align}
        sideOffset={8}
        className={cn(
          "w-[min(calc(100vw-2rem),20rem)] gap-0 overflow-hidden rounded-2xl border border-border/60 bg-popover/90 p-0 shadow-xl ring-1 ring-white/20 backdrop-blur-xl backdrop-saturate-150",
          "motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:zoom-out-100",
          "supports-[backdrop-filter]:bg-popover/75",
        )}
      >
        <div className="flex flex-wrap gap-1.5 border-b border-border/60 px-3 py-2.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handlePreset(preset)}
              className="rounded-full bg-muted/70 px-2.5 py-1 text-xs font-medium tracking-wide text-muted-foreground transition-[transform,background-color,color] duration-100 hover:bg-muted hover:text-foreground active:scale-[0.96] motion-reduce:active:scale-100"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="px-3 pt-3 pb-2">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-100 hover:bg-muted hover:text-foreground active:scale-90 motion-reduce:active:scale-100"
            >
              <ChevronLeft className="size-4" />
            </button>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {format(viewMonth, "MMMM yyyy")}
            </p>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-100 hover:bg-muted hover:text-foreground active:scale-90 motion-reduce:active:scale-100"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {weekdayLabels.map((day, index) => (
              <div
                key={`${day}-${index}`}
                className="py-1 text-center text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
              >
                {day}
              </div>
            ))}
          </div>

          <div
            className="grid grid-cols-7"
            onMouseLeave={() => setHoverDate(null)}
          >
            {days.map((day) => {
              const inMonth = isSameMonth(day, viewMonth);
              const selectedStart =
                effectiveStart && isSameDay(day, effectiveStart);
              const selectedEnd =
                effectiveEnd &&
                isSameDay(day, effectiveEnd) &&
                effectiveStart &&
                !isSameDay(effectiveStart, effectiveEnd);
              const selectedSingle =
                effectiveStart &&
                effectiveEnd &&
                isSameDay(effectiveStart, effectiveEnd) &&
                isSameDay(day, effectiveStart);
              const inRange =
                effectiveStart &&
                effectiveEnd &&
                !isBefore(day, effectiveStart) &&
                !isAfter(day, effectiveEnd);
              const today = isToday(day);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={!inMonth}
                  onClick={() => inMonth && handleDayClick(day)}
                  onMouseEnter={() => inMonth && setHoverDate(day)}
                  className={cn(
                    "relative flex h-9 items-center justify-center text-sm transition-[transform,background-color,color] duration-100 active:scale-[0.92] motion-reduce:active:scale-100",
                    !inMonth && "pointer-events-none opacity-0",
                    inMonth &&
                      !inRange &&
                      !selectedStart &&
                      !selectedEnd &&
                      !selectedSingle &&
                      "rounded-full text-foreground hover:bg-muted/80",
                    inRange &&
                      !selectedStart &&
                      !selectedEnd &&
                      !selectedSingle &&
                      "bg-primary/12 text-foreground",
                    selectedStart &&
                      !selectedSingle &&
                      "rounded-l-full bg-primary font-medium text-primary-foreground shadow-sm",
                    selectedEnd &&
                      "rounded-r-full bg-primary font-medium text-primary-foreground shadow-sm",
                    selectedSingle &&
                      "rounded-full bg-primary font-medium text-primary-foreground shadow-sm",
                    today &&
                      !selectedStart &&
                      !selectedEnd &&
                      !selectedSingle &&
                      "font-semibold text-primary",
                  )}
                >
                  {format(day, "d")}
                  {today && !selectedStart && !selectedEnd && (
                    <span className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {selectingEnd && draftFrom
              ? "Choose end date"
              : "Choose start date"}
          </p>
          {hasValue && (
            <button
              type="button"
              onClick={clearRange}
              className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
