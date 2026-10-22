import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * RecoverAgent page intro: a card holding the page's small uppercase
 * label, muted subtitle and an optional right-side chip/CTA row — the
 * same block the main Dashboard (.page-intro) and Voice (.oa-card) apps
 * open with. The sidebar already names the page, so the title is the
 * card's quiet label rather than a large heading. Visual only — callers
 * keep their own actions and copy.
 *
 * `eyebrow` and `size` are still accepted from callers but no longer
 * rendered: the sidebar group and the label cover them.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  size?: "default" | "admin";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-3xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 text-[13px] leading-normal text-muted-foreground">
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
