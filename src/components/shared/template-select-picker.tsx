"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  normalizeTemplateButtons,
  quickReplyButtonsFromTemplate,
} from "@/lib/flows/template-buttons";
import { cn } from "@/lib/utils";
import type { MessageTemplate } from "@/types";

export function toTemplateOptionValue(name: string, lang: string) {
  return `${name}::${lang}`;
}

export function fromTemplateOptionValue(value: string): {
  name: string;
  lang: string;
} {
  const [name, lang] = value.split("::");
  return { name: name ?? "", lang: lang ?? "en_US" };
}

function templateButtonHint(t: MessageTemplate): string | null {
  const qrCount = quickReplyButtonsFromTemplate(t).length;
  if (qrCount > 0) {
    return `${qrCount} quick repl${qrCount === 1 ? "y" : "ies"}`;
  }
  if (normalizeTemplateButtons(t.buttons).length > 0) {
    return "URL/CTA buttons only";
  }
  return null;
}

interface TemplateSelectPickerProps {
  templates: MessageTemplate[];
  value: string;
  onValueChange: (value: string) => void;
  /** When value is set but missing from the approved list. */
  orphanLabel?: { name: string; lang: string };
}

export function TemplateSelectPicker({
  templates,
  value,
  onValueChange,
  orphanLabel,
}: TemplateSelectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => {
    if (!value) return null;
    const { name, lang } = fromTemplateOptionValue(value);
    return (
      templates.find(
        (t) => t.name === name && (t.language ?? "en_US") === lang,
      ) ?? null
    );
  }, [templates, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const lang = (t.language ?? "en_US").toLowerCase();
      const hint = templateButtonHint(t)?.toLowerCase() ?? "";
      return (
        t.name.toLowerCase().includes(q) ||
        lang.includes(q) ||
        t.body_text.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        hint.includes(q)
      );
    });
  }, [templates, query]);

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("");
    setOpen(next);
  };

  const triggerHint = selected ? templateButtonHint(selected) : null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-between gap-2 bg-muted px-3 py-2 text-left font-normal hover:bg-muted/80"
          />
        }
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm text-foreground">{selected.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{selected.language ?? "en_US"}</span>
              {triggerHint ? <span>· {triggerHint}</span> : null}
            </span>
          </span>
        ) : orphanLabel ? (
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {orphanLabel.name} ({orphanLabel.lang}) — not in list
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Select a template…</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[min(480px,calc(100vw-2rem))] gap-0 p-0"
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, language, or body…"
              className="h-8 bg-muted pl-8 text-xs"
              autoFocus
            />
          </div>
        </div>

        <div
          className="max-h-72 overflow-y-auto p-1"
          role="listbox"
          aria-label="Templates"
        >
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No templates match your search.
            </p>
          ) : (
            filtered.map((t) => {
              const optionValue = toTemplateOptionValue(
                t.name,
                t.language ?? "en_US",
              );
              const isSelected = value === optionValue;
              const hint = templateButtonHint(t);

              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onValueChange(optionValue);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
                    isSelected && "bg-accent/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium break-all text-foreground">
                        {t.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {t.category}
                      </Badge>
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {t.language ?? "en_US"}
                      </span>
                    </div>
                    {hint ? (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {hint}
                      </p>
                    ) : null}
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {t.body_text}
                    </p>
                  </div>
                  {isSelected ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
