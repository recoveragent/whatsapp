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
  type GoogleSheetRowTriggerConfig,
} from "@/lib/google-sheets/trigger-config";
import { parseSpreadsheetId } from "@/lib/google-sheets/parse-sheet-url";
import { cn } from "@/lib/utils";

interface PreviewResponse {
  spreadsheetId?: string;
  title?: string;
  tabs?: Array<{ title: string; sheetId: number; index: number }>;
  headers?: string[];
  sheetName?: string;
  error?: string;
}

export function FlowGoogleSheetTriggerPanel({
  config,
  onChange,
}: {
  config: GoogleSheetRowTriggerConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(
    config.spreadsheet_url ||
      (config.spreadsheet_id
        ? `https://docs.google.com/spreadsheets/d/${config.spreadsheet_id}`
        : ""),
  );
  const [loading, setLoading] = useState(false);
  const [tabs, setTabs] = useState<string[]>(
    config.sheet_name ? [config.sheet_name] : [],
  );
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);

  const mappings = config.variable_mappings ?? {};

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
          sheet_name: sheetName || config.sheet_name || undefined,
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

      const nextSheet = data.sheetName || tabTitles[0] || "";
      const nextHeaders = data.headers ?? [];
      const phoneGuess =
        config.phone_column && nextHeaders.includes(config.phone_column)
          ? config.phone_column
          : nextHeaders.find((h) => /phone|mobile|whatsapp/i.test(h)) ||
            nextHeaders[0] ||
            "phone";
      const nameGuess =
        config.name_column && nextHeaders.includes(config.name_column)
          ? config.name_column
          : nextHeaders.find((h) => /^name$/i.test(h) || /full.?name/i.test(h)) ||
            config.name_column ||
            "name";
      const emailGuess =
        config.email_column && nextHeaders.includes(config.email_column)
          ? config.email_column
          : nextHeaders.find((h) => /email/i.test(h)) ||
            config.email_column ||
            "email";

      onChange({
        ...config,
        spreadsheet_id: data.spreadsheetId || id,
        spreadsheet_url: urlDraft.trim(),
        sheet_name: nextSheet,
        phone_column: phoneGuess,
        name_column: nameGuess,
        email_column: emailGuess,
      });
      toast.success("Sheet loaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load sheet");
    } finally {
      setLoading(false);
    }
  }

  function setField<K extends keyof GoogleSheetRowTriggerConfig>(
    key: K,
    value: GoogleSheetRowTriggerConfig[K],
  ) {
    onChange({ ...config, [key]: value });
  }

  const columnOptions =
    headers.length > 0
      ? headers
      : [
          config.phone_column,
          config.name_column,
          config.email_column,
        ].filter((h): h is string => Boolean(h && h.trim()));

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
        , paste the Sheet link, then map the phone column. New rows start this
        flow (polled every few minutes).
      </p>

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
            {config.spreadsheet_id
              ? ` · id ${config.spreadsheet_id.slice(0, 8)}…`
              : ""}
          </p>
        )}
      </div>

      {(tabs.length > 0 || config.sheet_name) && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Sheet tab
          </label>
          <Select
            value={config.sheet_name || undefined}
            onValueChange={(v) => {
              if (!v) return;
              setField("sheet_name", v);
              void loadPreview(v);
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder="Select tab" />
            </SelectTrigger>
            <SelectContent>
              {(tabs.length > 0 ? tabs : [config.sheet_name]).map((t) => (
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
          value={config.phone_column}
          options={columnOptions}
          onChange={(v) => setField("phone_column", v)}
        />
        <ColumnSelect
          label="Name column"
          value={config.name_column ?? ""}
          options={columnOptions}
          onChange={(v) => setField("name_column", v)}
          allowEmpty
        />
        <ColumnSelect
          label="Email column"
          value={config.email_column ?? ""}
          options={columnOptions}
          onChange={(v) => setField("email_column", v)}
          allowEmpty
        />
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={Boolean(config.sync_existing)}
          onChange={(e) => setField("sync_existing", e.target.checked)}
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
              const next = { ...mappings, "": columnOptions[0] ?? "" };
              setField("variable_mappings", next);
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
                  setField(
                    "variable_mappings",
                    Object.fromEntries(entries.filter(([k]) => k !== undefined)),
                  );
                }}
              />
              <Select
                value={column || undefined}
                onValueChange={(v) => {
                  if (v == null) return;
                  const entries = Object.entries(mappings);
                  entries[idx] = [varName, v];
                  setField("variable_mappings", Object.fromEntries(entries));
                }}
              >
                <SelectTrigger className={cn("bg-muted", !column && "text-muted-foreground")}>
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
                  setField("variable_mappings", next);
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
