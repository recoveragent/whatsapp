"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TemplateVariableGroup } from "@/lib/flows/template-variables";

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  boolean: "0110",
  array: "[]",
};

interface TemplateVariablePickerProps {
  groups: TemplateVariableGroup[];
  onInsert: (token: string) => void;
  className?: string;
}

export function TemplateVariablePicker({
  groups,
  onInsert,
  className,
}: TemplateVariablePickerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, true])),
  );

  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/20",
        className,
      )}
    >
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-semibold text-foreground">Add variables</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Click to insert into the focused field
        </p>
      </div>
      <div className="max-h-[min(50vh,20rem)] overflow-y-auto p-2">
        {groups.map((group) => {
          const open = expanded[group.id] ?? true;
          return (
            <div key={group.id} className="mb-1">
              <button
                type="button"
                onClick={() =>
                  setExpanded((s) => ({ ...s, [group.id]: !open }))
                }
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                {open ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                {group.label}
              </button>
              {open && (
                <ul className="space-y-0.5 pb-1">
                  {group.options.map((opt) => (
                    <li key={opt.token}>
                      <button
                        type="button"
                        onClick={() => onInsert(opt.token)}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                      >
                        <span className="truncate text-foreground">
                          {opt.label}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {TYPE_LABELS[opt.type ?? "text"] ?? "Text"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
