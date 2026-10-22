import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * RecoverAgent page header: tiny uppercase eyebrow, Cabinet H1, muted
 * subtitle, optional right-side chip/CTA row. Visual only — callers
 * keep their own actions and copy.
 *
 * The sidebar already names the current page (and its group), so by
 * default the title is kept for screen readers only and the eyebrow is
 * dropped. Pass `showTitle` for pages the sidebar doesn't list.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  size = "default",
  showTitle = false,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Admin/settings pages use a quieter 20px H1. */
  size?: "default" | "admin";
  showTitle?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:justify-between",
        showTitle ? "sm:items-end" : "sm:items-center",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && showTitle ? (
          <p className="font-cabinet text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            !showTitle
              ? "sr-only"
              : "font-cabinet font-medium tracking-tight text-foreground",
            showTitle && (size === "admin" ? "text-xl" : "text-2xl sm:text-3xl"),
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className={cn("text-sm text-muted-foreground", showTitle && "mt-1")}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
