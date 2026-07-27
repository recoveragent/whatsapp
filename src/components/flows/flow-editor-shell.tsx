"use client";

/**
 * Flow editor shell — header + canvas only.
 *
 * Canvas is the sole editor view (list view and the Canvas/List
 * switch were removed). Mobile still gets the canvas; zoom/pan
 * handles small screens better than maintaining a second layout.
 */

import { FlowCanvas } from "./flow-canvas";
import { FlowEditorProvider } from "./flow-editor-state";
import { EditorHeader } from "./header";
import { ValidationPanel } from "./validation-panel";
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types";

interface Props {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

export function FlowEditorShell({ initialFlow, initialNodes }: Props) {
  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="mx-auto flex min-h-0 w-full max-w-none flex-1 flex-col gap-2">
        <div className="shrink-0">
          <EditorHeader />
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <FlowCanvas />
          <ValidationPanel overlay />
        </div>
      </div>
    </FlowEditorProvider>
  );
}
