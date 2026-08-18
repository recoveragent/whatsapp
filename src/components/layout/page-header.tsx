import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * RecoverAgent page header: tiny uppercase eyebrow, Cabinet H1, muted
 * subtitle, optional right-side chip/CTA row. Visual only — callers
 * keep their own actions and copy.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  size = "default",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Admin/settings pages use a quieter 20px H1. */
  size?: "default" | "admin";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="font-cabinet text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className={cn(
            "font-cabinet font-bold text-foreground",
            size === "admin"
              ? "text-xl"
              : "text-2xl sm:text-3xl",
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
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
