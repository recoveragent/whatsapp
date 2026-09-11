"use client";

/**
 * Chrome for the flow editor.
 *
 * Lays the editor out as one app-like column that fills the dashboard
 * content area (toolbar → stage → validation bar). The active view
 * lives inside a rounded "stage" that owns its own scroll/overflow, so
 * the canvas can fill available height and the list scrolls internally.
 *
 * Desktop uses the canvas view; mobile falls back to the list editor
 * because drag-to-connect on a small screen is impractical.
 */

import { useEffect, useState } from "react";

import { FlowBuilder } from "./flow-builder";
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

  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="flex h-full min-h-0 flex-col">
        <EditorHeader />

        <div className="relative mx-6 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card-2">
          {!isMobile ? (
            <>
              <FlowCanvas />
              <ValidationPanel overlay />
            </>
          ) : (
            <div className="absolute inset-0 overflow-y-auto">
              <FlowBuilder />
            </div>
          )}
        </div>

        {isMobile && (
          <div className="px-6 pb-5 pt-3">
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
