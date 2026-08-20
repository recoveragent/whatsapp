"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultGoogleSheetSource,
  ensureGoogleSheetRowConfig,
  type GoogleSheetRowTriggerConfig,
  type GoogleSheetSource,
} from "@/lib/google-sheets/trigger-config";
import { parseSpreadsheetId } from "@/lib/google-sheets/parse-sheet-url";
import { guessEmailColumn, guessNameColumn } from "@/lib/google-sheets/sheet-columns";
import { cn } from "@/lib/utils";

interface PreviewResponse {
  spreadsheetId?: string;
  title?: string;
  tabs?: Array<{ title: string; sheetId: number; index: number }>;
  headers?: string[];
  sheetName?: string;
  header_row?: number;
  headerless?: boolean;
  suggested_phone_column?: string;
  error?: string;
}

export function FlowGoogleSheetTriggerPanel({
  config,
  onChange,
}: {
  config: GoogleSheetRowTriggerConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const ensured = ensureGoogleSheetRowConfig(
    config as unknown as Record<string, unknown>,
  );
  const sources = ensured.sources.length > 0 ? ensured.sources : [defaultGoogleSheetSource()];

  function setSources(next: GoogleSheetSource[]) {
    onChange({ sources: next });
  }

  function updateSource(index: number, patch: Partial<GoogleSheetSource>) {
    setSources(sources.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSource() {
    setSources([...sources, defaultGoogleSheetSource({ label: `Source ${sources.length + 1}` })]);
  }

  function removeSource(index: number) {
    if (sources.length <= 1) {
      toast.error("Keep at least one sheet source");
      return;
    }
    setSources(sources.filter((_, i) => i !== index));
  }

  return (
    <div className="md:col-span-2 space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Connect Google in{" "}
        <Link
          href="/settings?tab=google_sheets"
          className="underline underline-offset-2"
        >
          Settings → Google Sheets
        </Link>
        . Add one or more Sheet links — new rows from any of them start this
        flow (polled every few minutes).
      </p>

      <div className="space-y-3">
        {sources.map((source, index) => (
          <SheetSourceCard
            key={source.id}
            index={index}
            source={source}
            canRemove={sources.length > 1}
            onChange={(patch) => updateSource(index, patch)}
            onRemove={() => removeSource(index)}
          />
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addSource}>
        <Plus className="size-3.5" />
        <span className="ml-1.5">Add another sheet</span>
      </Button>
    </div>
  );
}

function SheetSourceCard({
  index,
  source,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  source: GoogleSheetSource;
  canRemove: boolean;
  onChange: (patch: Partial<GoogleSheetSource>) => void;
  onRemove: () => void;
}) {
  const [urlDraft, setUrlDraft] = useState(
    source.spreadsheet_url ||
      (source.spreadsheet_id
        ? `https://docs.google.com/spreadsheets/d/${source.spreadsheet_id}`
        : ""),
  );
  const [loading, setLoading] = useState(false);
  const [tabs, setTabs] = useState<string[]>(
    source.sheet_name ? [source.sheet_name] : [],
  );
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [headerless, setHeaderless] = useState(false);

  const mappings = source.variable_mappings ?? {};

  async function loadPreview(sheetName?: string) {
    const id = parseSpreadsheetId(urlDraft);
    if (!id) {
      toast.error("Paste a valid Google Sheet URL");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/google-sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheet_url: urlDraft.trim(),
          sheet_name: sheetName || source.sheet_name || undefined,
        }),
      });
      const data = (await res.json()) as PreviewResponse;
      if (!res.ok) {
        throw new Error(data.error ?? "Could not load spreadsheet");
      }

      const tabTitles = (data.tabs ?? []).map((t) => t.title);
      setTabs(tabTitles);
      setHeaders(data.headers ?? []);
      setSheetTitle(data.title ?? null);
      setHeaderless(Boolean(data.headerless));

      const nextSheet = data.sheetName || tabTitles[0] || "";
      const nextHeaders = data.headers ?? [];
      const phoneGuess =
        data.suggested_phone_column &&
        nextHeaders.includes(data.suggested_phone_column)
          ? data.suggested_phone_column
          : nextHeaders.includes(source.phone_column)
            ? source.phone_column
            : nextHeaders[0] || "phone";
      const nameGuessRaw =
        source.name_column && nextHeaders.includes(source.name_column)
          ? source.name_column
          : guessNameColumn(nextHeaders);
      const emailGuessRaw =
        source.email_column && nextHeaders.includes(source.email_column)
          ? source.email_column
          : guessEmailColumn(nextHeaders);
      const nameGuess = nextHeaders.includes(nameGuessRaw) ? nameGuessRaw : "";
      const emailGuess = nextHeaders.includes(emailGuessRaw)
        ? emailGuessRaw
        : "";

      onChange({
        spreadsheet_id: data.spreadsheetId || id,
        spreadsheet_url: urlDraft.trim(),
        sheet_name: nextSheet,
        phone_column: phoneGuess,
        name_column: nameGuess,
        email_column: emailGuess,
        header_row: data.header_row ?? (data.headerless ? 0 : 1),
        label: source.label?.trim() || data.title || `Source ${index + 1}`,
      });
      toast.success(
        data.headerless
          ? "Sheet loaded — this tab has no header row; phone was detected from cell values"
          : "Sheet loaded",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sheet");
    } finally {
      setLoading(false);
    }
  }

  const columnOptions =
    headers.length > 0
      ? headers
      : [source.phone_column, source.name_column, source.email_column].filter(
          (h): h is string => Boolean(h && h.trim()),
        );

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-xs text-muted-foreground">
            Source label
          </label>
          <Input
            value={source.label ?? ""}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={`Source ${index + 1}`}
            className="bg-muted"
          />
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-5 shrink-0"
            onClick={onRemove}
            aria-label="Remove sheet source"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Google Sheet URL
        </label>
        <div className="flex gap-2">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="bg-muted"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void loadPreview()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-1.5">Load</span>
          </Button>
        </div>
        {sheetTitle && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Loaded: {sheetTitle}
            {source.spreadsheet_id
              ? ` · id ${source.spreadsheet_id.slice(0, 8)}…`
              : ""}
          </p>
        )}
        {(headerless || source.header_row === 0) && (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            This tab has no header row — the first row is a lead. Phone is
            detected from values (not ad names that mention WhatsApp). Pick the
            column that actually contains numbers, then save the flow.
          </p>
        )}
      </div>

      {(tabs.length > 0 || source.sheet_name) && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Sheet tab
          </label>
          <Select
            value={source.sheet_name || undefined}
            onValueChange={(v) => {
              if (!v) return;
              onChange({ sheet_name: v });
              void loadPreview(v);
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder="Select tab" />
            </SelectTrigger>
            <SelectContent>
              {(tabs.length > 0 ? tabs : [source.sheet_name]).map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <ColumnSelect
          label="Phone column"
          required
          value={source.phone_column}
          options={columnOptions}
          onChange={(v) => onChange({ phone_column: v })}
        />
        <ColumnSelect
          label="Name column"
          value={source.name_column ?? ""}
          options={columnOptions}
          onChange={(v) => onChange({ name_column: v })}
          allowEmpty
        />
        <ColumnSelect
          label="Email column"
          value={source.email_column ?? ""}
          options={columnOptions}
          onChange={(v) => onChange({ email_column: v })}
          allowEmpty
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={Boolean(source.sync_existing)}
          onChange={(e) => onChange({ sync_existing: e.target.checked })}
        />
        <span>
          Process existing rows on first run (default: only new rows after
          activate).
        </span>
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Extra variable mappings
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => {
              onChange({
                variable_mappings: {
                  ...mappings,
                  "": columnOptions[0] ?? "",
                },
              });
            }}
          >
            <Plus className="size-3.5" />
            <span className="ml-1">Add</span>
          </Button>
        </div>
        <div className="space-y-2">
          {Object.entries(mappings).map(([varName, column], idx) => (
            <div key={`${varName}-${idx}`} className="flex gap-2">
              <Input
                value={varName}
                placeholder="flow variable"
                className="bg-muted"
                onChange={(e) => {
                  const entries = Object.entries(mappings);
                  entries[idx] = [e.target.value, column];
                  onChange({
                    variable_mappings: Object.fromEntries(
                      entries.filter(([k]) => k !== undefined),
                    ),
                  });
                }}
              />
              <Select
                value={column || undefined}
                onValueChange={(v) => {
                  if (v == null) return;
                  const entries = Object.entries(mappings);
                  entries[idx] = [varName, v];
                  onChange({
                    variable_mappings: Object.fromEntries(entries),
                  });
                }}
              >
                <SelectTrigger
                  className={cn("bg-muted", !column && "text-muted-foreground")}
                >
                  <SelectValue placeholder="Column" />
                </SelectTrigger>
                <SelectContent>
                  {columnOptions.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => {
                  const next = { ...mappings };
                  delete next[varName];
                  onChange({ variable_mappings: next });
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  options,
  onChange,
  required,
  allowEmpty,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  required?: boolean;
  allowEmpty?: boolean;
}) {
  const unique = [...new Set(options.filter(Boolean))];
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </label>
      {unique.length > 0 ? (
        <Select
          value={value || (allowEmpty ? "__none__" : undefined)}
          onValueChange={(v) => {
            if (v == null) return;
            onChange(v === "__none__" ? "" : v);
          }}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue placeholder="Column" />
          </SelectTrigger>
          <SelectContent>
            {allowEmpty && (
              <SelectItem value="__none__">— none —</SelectItem>
            )}
            {unique.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted"
          placeholder="phone"
        />
      )}
    </div>
  );
}
