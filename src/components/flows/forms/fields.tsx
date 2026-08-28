"use client";

/**
 * Reusable field components shared across every per-node form.
 *
 * `NodeKeySelect` — picks a node from the flow's node list, rendered
 * with the source node's icon so the dropdown reads as
 * "destination = ◇ menu" rather than an opaque slug.
 *
 * `NextNodeRow` — wraps NodeKeySelect with a label; the most common
 * per-node form row ("after this node, advance to…").
 *
 * `TextRow` — wraps Input or Textarea behind a label. Pure UI sugar
 * to keep per-node forms uncluttered.
 *
 * `ContactFieldSelect` — built-in contact columns plus account custom
 * fields for update_contact_field nodes.
 *
 * Lives in src/components/flows/forms/ so both the list view's
 * collapsed-card editor and the canvas view's side-panel editor
 * (introduced in this PR) mount the exact same form components.
 */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { CustomField } from "@/types";
import type { ContactFieldMapping } from "@/lib/flows/types";
import { NODE_META, type BuilderNode } from "../shared";

export function TextRow({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {rows > 1 ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="bg-muted"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted"
        />
      )}
    </div>
  );
}

export function NextNodeRow({
  value,
  allNodes,
  currentKey,
  onChange,
  label,
}: {
  value: string;
  allNodes: BuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <NodeKeySelect
        value={value || null}
        nodes={allNodes}
        excludeKey={currentKey}
        onChange={(v) => onChange(v ?? "")}
        placeholder="Pick a next node…"
      />
    </div>
  );
}

export function NodeKeySelect({
  value,
  nodes,
  excludeKey,
  onChange,
  placeholder,
  className,
}: {
  value: string | null;
  nodes: BuilderNode[];
  excludeKey?: string;
  onChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const options = nodes.filter((n) => n.node_key !== excludeKey);
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={cn("bg-muted", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— None —</SelectItem>
        {options.map((n) => {
          const Icon = NODE_META[n.node_type].icon;
          return (
            <SelectItem key={n.node_key} value={n.node_key}>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  className={cn("h-3 w-3", NODE_META[n.node_type].color)}
                />
                {n.node_key}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function useCustomFields(): CustomField[] {
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("custom_fields")
          .select("*")
          .order("field_name");
        if (!cancelled) setCustomFields((data as CustomField[] | null) ?? []);
      } catch {
        // Custom fields unavailable — built-in columns still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return customFields;
}

export function ContactFieldSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const customFields = useCustomFields();
  const customValue = value.startsWith("custom:") ? value : "";
  const knownCustom =
    customValue &&
    customFields.some((field) => `custom:${field.id}` === customValue);

  return (
    <Select
      value={value || "name"}
      onValueChange={(v) => onChange(v ?? "name")}
    >
      <SelectTrigger className="bg-muted">
        <SelectValue placeholder="Pick a field…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="name">Name</SelectItem>
        <SelectItem value="email">Email</SelectItem>
        <SelectItem value="company">Company</SelectItem>
        {customFields.length > 0 && (
          <SelectGroup>
            <SelectLabel>Custom fields</SelectLabel>
            {customFields.map((field) => (
              <SelectItem key={field.id} value={`custom:${field.id}`}>
                {field.field_name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {customValue && !knownCustom && (
          <SelectItem value={customValue}>{customValue} (unknown field)</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

export function normalizeContactFieldRows(
  cfg: Record<string, unknown>,
): ContactFieldMapping[] {
  const fields = cfg.fields;
  if (Array.isArray(fields) && fields.length > 0) {
    return fields.map((entry) => {
      const row = entry as Partial<ContactFieldMapping>;
      return {
        field: typeof row.field === "string" ? row.field : "name",
        value: typeof row.value === "string" ? row.value : "",
      };
    });
  }
  return [
    {
      field: typeof cfg.field === "string" ? cfg.field : "name",
      value: typeof cfg.value === "string" ? cfg.value : "",
    },
  ];
}

export function UpdateContactFieldsForm({
  cfg,
  onUpdateConfig,
}: {
  cfg: Record<string, unknown>;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const rows = normalizeContactFieldRows(cfg);

  function setRows(nextRows: ContactFieldMapping[]) {
    onUpdateConfig({
      fields: nextRows,
      field: undefined,
      value: undefined,
    });
  }

  function updateRow(index: number, patch: Partial<ContactFieldMapping>) {
    const nextRows = rows.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    setRows(nextRows);
  }

  function addRow() {
    setRows([...rows, { field: "email", value: "" }]);
  }

  function removeRow(index: number) {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div
          key={`${index}-${row.field}`}
          className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Field {index + 1}
            </span>
            {rows.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(index)}
                aria-label={`Remove field ${index + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Field
            </label>
            <ContactFieldSelect
              value={row.field}
              onChange={(field) => updateRow(index, { field })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Value (supports {"{{ vars.x }}"})
            </label>
            <Input
              value={row.value}
              onChange={(e) => updateRow(index, { value: e.target.value })}
              placeholder="{{ vars.email }}"
              className="bg-muted"
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addRow}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add field
      </Button>
    </div>
  );
}
