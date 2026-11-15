"use client";

/**
 * Chrome for the flow editor.
 *
 * Lays the editor out as one app-like column that fills the dashboard
 * content area (toolbar → stage → validation bar). The active view
 * lives inside a rounded "stage" that owns its own scroll/overflow, so
 * the canvas can fill available height and the list scrolls internally.
 *
 * The canvas is shared across desktop and mobile screen sizes.
 */

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { FlowCanvas } from "./flow-canvas";
import { FlowEditorProvider } from "./flow-editor-state";
import { EditorHeader } from "./header";
import { ValidationPanel } from "./validation-panel";
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types";

/** Matches Tailwind's `md` breakpoint. */
const MOBILE_BREAKPOINT = "(max-width: 767px)";

interface Props {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

export function FlowEditorShell({ initialFlow, initialNodes }: Props) {
  const isMobile = useMatchMedia(MOBILE_BREAKPOINT);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Let an open node editor handle Escape before closing the canvas.
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="flex h-full min-h-0 flex-col">
        <EditorHeader />

        <div
          className={cn(
            "relative mx-3 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card-2 sm:mx-6",
            expanded && "!fixed !inset-0 !z-40 !m-0 !rounded-none",
          )}
        >
          <FlowCanvas />
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "Exit full screen canvas" : "Expand canvas"}
            title={expanded ? "Exit full screen" : "Expand canvas"}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-md transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {(!isMobile || expanded) && <ValidationPanel overlay />}
        </div>

        {isMobile && !expanded && (
          <div className="px-3 pb-3 pt-2 sm:px-6">
            <ValidationPanel />
          </div>
        )}
      </div>
    </FlowEditorProvider>
  );
}

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}
