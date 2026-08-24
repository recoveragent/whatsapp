"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
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

function filterGroups(
  groups: TemplateVariableGroup[],
  query: string,
): TemplateVariableGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.token.toLowerCase().includes(q),
      ),
    }))
    .filter((group) => group.options.length > 0)
}

export function TemplateVariablePicker({
  groups,
  onInsert,
  className,
}: TemplateVariablePickerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.id, true])),
  );

  const filteredGroups = useMemo(
    () => filterGroups(groups, query),
    [groups, query],
  );

  const searching = query.trim().length > 0;

  if (groups.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/20",
        className,
      )}
    >
      <div className="space-y-2 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-semibold text-foreground">Add variables</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Click to insert into the focused field
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search variables…"
            className="h-8 bg-background pl-8 text-xs"
          />
        </div>
      </div>
      <div className="max-h-[min(50vh,20rem)] overflow-y-auto p-2">
        {filteredGroups.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">
            No variables match &ldquo;{query.trim()}&rdquo;
          </p>
        ) : (
          filteredGroups.map((group) => {
            const open = searching || (expanded[group.id] ?? true);
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
                          className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="min-w-0 break-words text-xs text-foreground">
                              {opt.label}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              {TYPE_LABELS[opt.type ?? "text"] ?? "Text"}
                            </span>
                          </span>
                          <span className="break-all font-mono text-[10px] leading-snug text-muted-foreground">
                            {opt.token}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
