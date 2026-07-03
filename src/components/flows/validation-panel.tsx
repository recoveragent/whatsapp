"use client";

/**
 * Validation panel — surfaces every error and warning from
 * `validateFlowForActivation`. Floats bottom-right as an overlay so
 * the canvas can use the full editor height.
 */

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ValidationIssue } from "@/lib/flows/validate";
import { useFlowEditor } from "./flow-editor-state";
import { TRIGGER_NODE_ID } from "./trigger-panel";

export function ValidationPanel({ overlay = false }: { overlay?: boolean }) {
  const { issues, requestFlash } = useFlowEditor();
  const [expanded, setExpanded] = useState(true);
  const [dismissedOk, setDismissedOk] = useState(false);

  const hasIssues = issues.length > 0;

  if (!hasIssues) {
    if (!overlay || dismissedOk) return null;
    return (
      <div
        className={cn(
          "pointer-events-auto",
          overlay &&
            "absolute bottom-4 right-4 z-30 w-full max-w-xs sm:max-w-sm",
        )}
      >
        <div className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-card/95 p-3 text-sm font-medium text-emerald-300 shadow-lg backdrop-blur">
          <CircleCheck className="h-4 w-4 shrink-0" />
          <span className="flex-1">Ready to activate</span>
          <button
            type="button"
            onClick={() => setDismissedOk(true)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const hasErrors = errors.length > 0;

  return (
    <div
      className={cn(
        "pointer-events-auto",
        overlay &&
          "absolute bottom-4 right-4 z-30 w-full max-w-xs sm:max-w-sm",
      )}
      role="alert"
    >
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-card/95 shadow-xl backdrop-blur",
          hasErrors ? "border-red-500/40" : "border-amber-500/40",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-muted-foreground hover:bg-muted/40"
        >
          <CircleAlert
            className={cn(
              "h-4 w-4 shrink-0",
              hasErrors ? "text-red-400" : "text-amber-400",
            )}
          />
          <span className="flex-1 font-medium text-foreground">
            {errors.length} error{errors.length === 1 ? "" : "s"},{" "}
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        {expanded && (
          <div className="max-h-48 overflow-y-auto border-t border-border px-1 py-1">
            {issues.map((i, ix) => (
              <IssueLine key={ix} issue={i} onJump={requestFlash} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Exported so the per-node card (list view) and the trigger panel
 * can render the same "icon + node key chip + message" formatting
 * for their own per-row issue lists without re-implementing the
 * tone / icon / accessibility logic.
 */
export function IssueLine({
  issue,
  onJump,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
}) {
  const tone =
    issue.severity === "error" ? "text-red-300" : "text-amber-300";
  const iconTone =
    issue.severity === "error" ? "text-red-400" : "text-amber-400";
  const body = (
    <>
      <CircleAlert className={cn("mt-0.5 h-3 w-3 shrink-0", iconTone)} />
      <span className="min-w-0 flex-1">
        {issue.node_key && (
          <code className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
            {issue.node_key}
          </code>
        )}
        {issue.message}
      </span>
    </>
  );

  const jumpKey =
    issue.scope === "trigger" ? TRIGGER_NODE_ID : issue.node_key;

  if (jumpKey && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(jumpKey)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60",
          tone,
        )}
        aria-label={
          issue.scope === "trigger"
            ? "Jump to trigger"
            : `Jump to node ${issue.node_key}`
        }
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
        tone,
      )}
    >
      {body}
    </div>
  );
}
