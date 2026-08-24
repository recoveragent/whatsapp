"use client";

/**
 * Per-node configuration form, dispatched by node_type.
 *
 * One component, ten branches. Each branch renders the inputs that
 * map onto the node's `config` JSONB shape (text + buttons for
 * send_buttons, prompt + var_key for collect_input, etc.) and forwards
 * edits up via `onUpdateConfig`.
 *
 * Why this lives in src/components/flows/forms/ instead of next to
 * the list editor: PR 2 (canvas editing) needs to mount the same
 * form in a side panel when a user clicks a node on the canvas.
 * Keeping the per-node forms here means there's exactly one place
 * where each form's behaviour and validation lives — drift between
 * "what the list editor shows" and "what the canvas side panel
 * shows" becomes impossible.
 *
 * `showAdvanced` is the disclosure that surfaces internal
 * identifiers (node_key, button reply_id, list row reply_id) — owned
 * by the host (NodeCard / SideSheet) so the toggle is rendered
 * outside this form alongside whatever delete/cancel buttons that
 * host wants. The form just reads the boolean and conditionally
 * renders the advanced rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { uploadAccountMedia, MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import {
  SHOPIFY_PAYMENT_STATUSES,
  SHOPIFY_PAYMENT_STATUS_LABELS,
} from "@/lib/flows/trigger-types";
import { slugify, type BuilderNode } from "../shared";
import {
  nodeTypeHasReplyTimeoutSlot,
  hasReplyTimeoutTiming,
  showReplyTimeoutHandle,
} from "@/lib/flows/reply-timeout";
import { NextNodeRow, NodeKeySelect, TextRow } from "./fields";
import { SendTemplateFields } from "@/components/shared/send-template-fields";
import { templateVariableGroupsForFlow } from "@/lib/flows/template-variables";
import type { TemplateQuickReplyButton } from "@/lib/flows/template-buttons";
import type { FlowTriggerType } from "@/lib/flows/trigger-types";
import { createClient } from "@/lib/supabase/client";

interface NodeConfigFormProps {
  node: BuilderNode;
  allNodes: BuilderNode[];
  showAdvanced: boolean;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  triggerType?: FlowTriggerType;
  triggerConfig?: Record<string, unknown>;
}

export function NodeConfigForm({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
  triggerType,
  triggerConfig,
}: NodeConfigFormProps) {
  return (
    <>
      {renderNodeConfigBody({
        node,
        allNodes,
        showAdvanced,
        onUpdateConfig,
        triggerType,
        triggerConfig,
      })}
      {nodeTypeHasReplyTimeoutSlot(node.node_type) ? (
        <ReplyTimeoutSection cfg={node.config} onUpdateConfig={onUpdateConfig} />
      ) : null}
    </>
  );
}

function renderNodeConfigBody({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
  triggerType,
  triggerConfig,
}: NodeConfigFormProps) {
  const cfg = node.config;
  switch (node.node_type) {
    case "start":
      return (
        <NextNodeRow
          value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
          allNodes={allNodes}
          currentKey={node.node_key}
          onChange={(v) => onUpdateConfig({ next_node_key: v })}
          label="Advances to"
        />
      );

    case "send_message":
      return (
        <>
          <TextRow
            label="Text sent to the customer"
            value={(cfg as { text?: string }).text ?? ""}
            onChange={(v) => onUpdateConfig({ text: v })}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Advances to"
          />
        </>
      );

    case "send_buttons":
      return (
        <SendButtonsForm
          cfg={cfg as SendButtonsCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      );

    case "send_list":
      return (
        <SendListForm
          cfg={cfg as SendListCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          showAdvanced={showAdvanced}
        />
      );

    case "send_media":
      return (
        <SendMediaForm
          cfg={cfg as SendMediaCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "collect_input":
      return (
        <>
          <TextRow
            label="Prompt sent to the customer"
            value={(cfg as { prompt_text?: string }).prompt_text ?? ""}
            onChange={(v) => onUpdateConfig({ prompt_text: v })}
            rows={2}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Variable key (stored in flow_runs.vars; alphanumeric + underscore)
            </label>
            <Input
              value={(cfg as { var_key?: string }).var_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({
                  var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                })
              }
              placeholder="e.g. name, email, company"
              className="bg-muted font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Interpolate in downstream prompts and handoff notes with{" "}
              <code className="rounded bg-muted px-1">
                {"{{vars."}
                {(cfg as { var_key?: string }).var_key || "name"}
                {"}}"}
              </code>
              .
            </p>
          </div>
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="After capturing, advance to"
          />
        </>
      );

    case "send_address":
      return (
        <SendAddressForm
          cfg={cfg as SendAddressCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "send_flow":
      return (
        <SendFlowForm
          cfg={cfg as SendFlowCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "condition":
      return (
        <ConditionForm
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "switch":
      return (
        <SwitchForm
          cfg={cfg as SwitchCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "set_tag":
      return (
        <SetTagForm
          cfg={cfg as SetTagCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "handoff":
      return (
        <TextRow
          label="Internal note (for the agent picking up)"
          value={(cfg as { note?: string }).note ?? ""}
          onChange={(v) => onUpdateConfig({ note: v })}
          rows={2}
        />
      );

    case "send_template":
      return (
        <>
          <SendTemplateFields
            templateName={(cfg as { template_name?: string }).template_name ?? ""}
            language={(cfg as { language?: string }).language ?? "en_US"}
            variables={
              ((cfg as { variables?: Record<string, string> }).variables ??
                {}) as Record<string, string>
            }
            buttons={
              ((cfg as { buttons?: TemplateQuickReplyButton[] }).buttons ??
                []) as TemplateQuickReplyButton[]
            }
            nextNodeKey={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentNodeKey={node.node_key}
            onChange={(patch) => onUpdateConfig({ ...patch })}
            variableGroups={templateVariableGroupsForFlow(triggerType, triggerConfig)}
            variableHint="Focus a field, then pick a variable from the list. User attributes come from the contact; trigger attributes depend on your flow trigger."
          />
        </>
      );

    case "wait": {
      const mode =
        (cfg as { mode?: string }).mode === "until" ? "until" : "delay";
      return (
        <>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Wait mode
            </label>
            <Select
              value={mode}
              onValueChange={(v) =>
                onUpdateConfig({
                  mode: v,
                  ...(v === "until"
                    ? { datetime_var: (cfg as { datetime_var?: string }).datetime_var || "meeting_start" }
                    : {}),
                })
              }
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delay">Delay from now</SelectItem>
                <SelectItem value="until">Until datetime variable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "delay" ? (
            <>
              <TextRow
                label="Amount"
                value={String((cfg as { amount?: number }).amount ?? 1)}
                onChange={(v) =>
                  onUpdateConfig({ amount: Math.max(1, Number(v) || 1) })
                }
              />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Unit
                </label>
                <Select
                  value={(cfg as { unit?: string }).unit ?? "hours"}
                  onValueChange={(v) => onUpdateConfig({ unit: v })}
                >
                  <SelectTrigger className="bg-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <>
              <TextRow
                label="Datetime variable"
                value={
                  (cfg as { datetime_var?: string }).datetime_var ??
                  "meeting_start"
                }
                onChange={(v) => onUpdateConfig({ datetime_var: v.trim() })}
              />
              <TextRow
                label="Offset minutes (negative = before)"
                value={String(
                  (cfg as { offset_minutes?: number }).offset_minutes ?? -60,
                )}
                onChange={(v) => {
                  const n = Number(v);
                  onUpdateConfig({
                    offset_minutes: Number.isFinite(n) ? n : -60,
                  });
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                Example:{" "}
                <code className="text-[10px]">meeting_start</code> with{" "}
                <code className="text-[10px]">-60</code> = 1 hour before.
                Uses <code className="text-[10px]">meeting_start_iso</code>{" "}
                when present (raw ISO from webhook).
              </p>
            </>
          )}
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Advances to after wait"
          />
        </>
      );
    }

    case "send_webhook":
    case "http_fetch":
      return (
        <>
          <TextRow
            label="URL"
            value={(cfg as { url?: string }).url ?? ""}
            onChange={(v) => onUpdateConfig({ url: v })}
          />
          <TextRow
            label="Body template (JSON)"
            value={(cfg as { body_template?: string }).body_template ?? ""}
            onChange={(v) => onUpdateConfig({ body_template: v })}
            rows={3}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Advances to"
          />
        </>
      );

    case "update_contact_field":
      return (
        <>
          <TextRow
            label="Field"
            value={(cfg as { field?: string }).field ?? "name"}
            onChange={(v) => onUpdateConfig({ field: v })}
          />
          <TextRow
            label="Value (supports {{vars.x}})"
            value={(cfg as { value?: string }).value ?? ""}
            onChange={(v) => onUpdateConfig({ value: v })}
          />
          <NextNodeRow
            value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(v) => onUpdateConfig({ next_node_key: v })}
            label="Advances to"
          />
        </>
      );

    case "assign_conversation":
    case "close_conversation":
      return (
        <NextNodeRow
          value={(cfg as { next_node_key?: string }).next_node_key ?? ""}
          allNodes={allNodes}
          currentKey={node.node_key}
          onChange={(v) => onUpdateConfig({ next_node_key: v })}
          label="Advances to"
        />
      );

    case "create_deal":
      return (
        <CreateDealForm
          cfg={cfg as CreateDealCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "end":
      return (
        <p className="text-xs text-muted-foreground">
          Terminal node. When the runner reaches this node the run is marked
          complete. No config needed.
        </p>
      );
  }
}

// ============================================================
// Timeout branch (optional, on nodes that wait for customer input)
// ============================================================

interface ReplyTimeoutCfg {
  reply_timeout_enabled?: boolean;
  reply_timeout_amount?: unknown;
  reply_timeout_unit?: string;
  reply_timeout_next_node_key?: string;
}

function ReplyTimeoutSection({
  cfg,
  onUpdateConfig,
}: {
  cfg: ReplyTimeoutCfg;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const enabled =
    cfg.reply_timeout_enabled === true ||
    (cfg.reply_timeout_enabled !== false &&
      hasReplyTimeoutTiming(cfg as Record<string, unknown>));
  const amount =
    cfg.reply_timeout_amount === undefined || cfg.reply_timeout_amount === null
      ? ""
      : String(cfg.reply_timeout_amount);
  const unit =
    typeof cfg.reply_timeout_unit === "string" && cfg.reply_timeout_unit
      ? cfg.reply_timeout_unit
      : "hours";
  const target =
    typeof cfg.reply_timeout_next_node_key === "string"
      ? cfg.reply_timeout_next_node_key.trim()
      : "";
  const handleVisible = showReplyTimeoutHandle(cfg as Record<string, unknown>);

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked) {
              const hasAmount =
                cfg.reply_timeout_amount !== undefined &&
                cfg.reply_timeout_amount !== null &&
                String(cfg.reply_timeout_amount).trim() !== "";
              onUpdateConfig({
                reply_timeout_enabled: true,
                reply_timeout_amount: hasAmount ? cfg.reply_timeout_amount : 1,
                reply_timeout_unit:
                  typeof cfg.reply_timeout_unit === "string" &&
                  cfg.reply_timeout_unit
                    ? cfg.reply_timeout_unit
                    : "hours",
              });
              return;
            }
            onUpdateConfig({
              reply_timeout_enabled: false,
              reply_timeout_amount: "",
              reply_timeout_next_node_key: "",
            });
          }}
        />
        <span>
          <span className="font-medium text-foreground">
            Timeout branch (if no reply)
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            Separate from the Wait node. Use this only when you want a path if
            the customer ignores buttons or text prompts after this step.
          </span>
        </span>
      </label>
      {enabled ? (
        <>
          <div className="mt-3 flex gap-2">
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                onUpdateConfig({
                  reply_timeout_amount: v === "" ? "" : Number(v),
                });
              }}
              placeholder="e.g. 24"
              className="bg-muted"
            />
            <Select
              value={unit}
              onValueChange={(v) => onUpdateConfig({ reply_timeout_unit: v })}
            >
              <SelectTrigger className="w-[120px] bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="days">Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {handleVisible ? (
            <p className="mt-2 text-[10px] text-muted-foreground">
              A <span className="font-medium text-foreground">Timeout</span>{" "}
              handle is on the canvas
              {target ? (
                <>
                  {" "}
                  — connected to{" "}
                  <code className="rounded bg-muted px-1 font-mono">
                    {target}
                  </code>
                </>
              ) : (
                <> — connect it to the node to run after that time</>
              )}
              .
            </p>
          ) : (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Set a duration above to show the Timeout handle on the canvas.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

// ============================================================
// send_buttons
// ============================================================

interface SendButtonsCfg extends ReplyTimeoutCfg {
  text?: string;
  footer_text?: string;
  buttons?: Array<{ reply_id: string; title: string; next_node_key: string }>;
}

function SendButtonsForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const buttons = cfg.buttons ?? [];
  const updateButton = (
    idx: number,
    patch: Partial<NonNullable<SendButtonsCfg["buttons"]>[number]>,
  ) => {
    onUpdateConfig({
      buttons: buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const addButton = () =>
    onUpdateConfig({
      buttons: [
        ...buttons,
        {
          reply_id: `btn_${buttons.length + 1}`,
          title: "Option",
          next_node_key: "",
        },
      ],
    });
  const removeButton = (idx: number) =>
    onUpdateConfig({ buttons: buttons.filter((_, i) => i !== idx) });

  return (
    <>
      <TextRow
        label="Body text"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label="Footer (optional, 60 chars)"
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            Buttons (1–3) — each one routes to a different next node
          </label>
        </div>
        <div className="flex flex-col gap-3">
          {buttons.map((b, i) => (
            <div
              key={i}
              className={cn(
                "grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/40 p-3",
                showAdvanced
                  ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                  : "md:grid-cols-[2fr_2fr_auto]",
              )}
            >
              {showAdvanced && (
                <Input
                  value={b.reply_id}
                  onChange={(e) =>
                    updateButton(i, {
                      reply_id: slugify(e.target.value, `btn_${i + 1}`),
                    })
                  }
                  placeholder="reply_id"
                  className="bg-muted font-mono text-xs"
                />
              )}
              <Input
                value={b.title}
                onChange={(e) => updateButton(i, { title: e.target.value })}
                placeholder="Visible title (≤20 chars)"
                className="bg-muted"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder="Next node…"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeButton(i)}
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {buttons.length < 3 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={addButton}
            className="mt-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Add button
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// send_list
// ============================================================

interface SendListCfg extends ReplyTimeoutCfg {
  text?: string;
  button_label?: string;
  footer_text?: string;
  sections?: Array<{
    title?: string;
    rows: Array<{
      reply_id: string;
      title: string;
      description?: string;
      next_node_key: string;
    }>;
  }>;
}

function SendListForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  showAdvanced,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
}) {
  const sections = cfg.sections ?? [];
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);

  const updateSection = (
    sIdx: number,
    patch: Partial<NonNullable<SendListCfg["sections"]>[number]>,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, ...patch } : s,
      ),
    });
  };
  const addSection = () =>
    onUpdateConfig({
      sections: [
        ...sections,
        {
          title: "",
          rows: [
            {
              reply_id: `row_${totalRows + 1}`,
              title: `Option ${totalRows + 1}`,
              next_node_key: "",
            },
          ],
        },
      ],
    });
  const removeSection = (sIdx: number) =>
    onUpdateConfig({ sections: sections.filter((_, i) => i !== sIdx) });
  const updateRow = (
    sIdx: number,
    rIdx: number,
    patch: Partial<
      NonNullable<SendListCfg["sections"]>[number]["rows"][number]
    >,
  ) => {
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: s.rows.map((r, j) => (j === rIdx ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    });
  };
  const addRow = (sIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  reply_id: `row_${totalRows + 1}`,
                  title: `Option ${totalRows + 1}`,
                  next_node_key: "",
                },
              ],
            }
          : s,
      ),
    });
  const removeRow = (sIdx: number, rIdx: number) =>
    onUpdateConfig({
      sections: sections.map((s, i) =>
        i === sIdx ? { ...s, rows: s.rows.filter((_, j) => j !== rIdx) } : s,
      ),
    });

  return (
    <>
      <TextRow
        label="Body text"
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextRow
          label="Tap-to-expand button label (≤20 chars)"
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label="Footer (optional, 60 chars)"
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <div className="mt-2">
        <label className="mb-2 block text-xs text-muted-foreground">
          Rows (1–10 total across all sections)
        </label>
        {sections.map((section, sIdx) => (
          <div
            key={sIdx}
            className="mb-3 rounded-md border border-border bg-muted/40 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <Input
                value={section.title ?? ""}
                onChange={(e) =>
                  updateSection(sIdx, { title: e.target.value })
                }
                placeholder={`Section ${sIdx + 1} title (optional)`}
                className="bg-muted text-xs"
              />
              {sections.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(sIdx)}
                  className="shrink-0 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  aria-label="Remove section"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {section.rows.map((row, rIdx) => (
              <div
                key={rIdx}
                className={cn(
                  "mb-2 grid grid-cols-1 gap-2",
                  showAdvanced
                    ? "md:grid-cols-[1fr_2fr_2fr_auto]"
                    : "md:grid-cols-[2fr_2fr_auto]",
                )}
              >
                {showAdvanced && (
                  <Input
                    value={row.reply_id}
                    onChange={(e) =>
                      updateRow(sIdx, rIdx, {
                        reply_id: slugify(
                          e.target.value,
                          `row_${rIdx + 1}`,
                        ),
                      })
                    }
                    placeholder="reply_id"
                    className="bg-muted font-mono text-xs"
                  />
                )}
                <Input
                  value={row.title}
                  onChange={(e) =>
                    updateRow(sIdx, rIdx, { title: e.target.value })
                  }
                  placeholder="Row title (≤24)"
                  className="bg-muted"
                  maxLength={24}
                />
                <NodeKeySelect
                  value={row.next_node_key || null}
                  nodes={allNodes}
                  excludeKey={currentKey}
                  onChange={(v) =>
                    updateRow(sIdx, rIdx, { next_node_key: v ?? "" })
                  }
                  placeholder="Next node…"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(sIdx, rIdx)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {totalRows < 10 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRow(sIdx)}
                className="mt-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add row
              </Button>
            )}
          </div>
        ))}
        {/* WhatsApp's interactive-list spec caps sections at 10. Group rows
            by category (Billing / Support / Sales etc.) to give customers a
            scannable menu. */}
        {sections.length < 10 && (
          <Button variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3.5 w-3.5" />
            Add section
          </Button>
        )}
      </div>
    </>
  );
}

// ============================================================
// send_address
// ============================================================

interface SendAddressCfg extends ReplyTimeoutCfg {
  body_text?: string;
  header_text?: string;
  footer_text?: string;
  country?: "IN" | "SG";
  var_key?: string;
  prefill_from_shopify?: boolean;
  next_node_key?: string;
}

function SendAddressForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SendAddressCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const prefillShopify = cfg.prefill_from_shopify !== false;

  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        Opens WhatsApp&apos;s native address form. Available for India and
        Singapore recipients only.
      </p>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Country
        </label>
        <Select
          value={cfg.country ?? "IN"}
          onValueChange={(v) =>
            onUpdateConfig({ country: v as "IN" | "SG" })
          }
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="IN">India (IN)</SelectItem>
            <SelectItem value="SG">Singapore (SG)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <TextRow
        label="Body text"
        value={cfg.body_text ?? ""}
        onChange={(v) => onUpdateConfig({ body_text: v })}
        rows={2}
      />
      <TextRow
        label="Header (optional)"
        value={cfg.header_text ?? ""}
        onChange={(v) => onUpdateConfig({ header_text: v })}
        rows={1}
      />
      <TextRow
        label="Footer (optional)"
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
        rows={1}
      />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Variable key (stored in flow_runs.vars)
        </label>
        <Input
          value={cfg.var_key ?? ""}
          onChange={(e) =>
            onUpdateConfig({
              var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
            })
          }
          placeholder="e.g. address, shipping_address"
          className="bg-muted font-mono text-xs"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Stores a structured object. Use{" "}
          <code className="rounded bg-muted px-1">
            {"{{vars."}
            {cfg.var_key || "address"}
            {"}}"}
          </code>{" "}
          for the formatted address in later messages.
        </p>
      </div>
      <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={prefillShopify}
          onChange={(e) =>
            onUpdateConfig({ prefill_from_shopify: e.target.checked })
          }
        />
        <span>
          <span className="font-medium text-foreground">
            Prefill from Shopify
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            When Shopify is connected, show shipping addresses from this
            customer&apos;s 3 most recent Shopify orders only.
          </span>
        </span>
      </label>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="After address is submitted, advance to"
      />
    </>
  );
}

// ============================================================
// send_flow
// ============================================================

interface SendFlowCfg extends ReplyTimeoutCfg {
  body_text?: string;
  header_text?: string;
  footer_text?: string;
  flow_id?: string;
  flow_cta?: string;
  flow_message_version?: string;
  flow_screen?: string;
  var_key?: string;
  next_node_key?: string;
}

function SendFlowForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SendFlowCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        Sends a Meta-published WhatsApp Flow form. Submissions arrive as
        structured fields you can use in later steps via{" "}
        <code className="rounded bg-muted px-1">{"{{vars.<key>}}"}</code>.
      </p>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Flow ID
        </label>
        <Input
          value={cfg.flow_id ?? ""}
          onChange={(e) => onUpdateConfig({ flow_id: e.target.value.trim() })}
          placeholder="Meta Flow ID from WhatsApp Manager"
          className="bg-muted font-mono text-xs"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          CTA button label
        </label>
        <Input
          value={cfg.flow_cta ?? "Open form"}
          onChange={(e) => onUpdateConfig({ flow_cta: e.target.value })}
          placeholder="Open form"
          className="bg-muted text-xs"
        />
      </div>
      <TextRow
        label="Body text"
        value={cfg.body_text ?? ""}
        onChange={(v) => onUpdateConfig({ body_text: v })}
        rows={2}
      />
      <TextRow
        label="Header (optional)"
        value={cfg.header_text ?? ""}
        onChange={(v) => onUpdateConfig({ header_text: v })}
        rows={1}
      />
      <TextRow
        label="Footer (optional)"
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
        rows={1}
      />
      <TextRow
        label="First screen ID (optional)"
        value={cfg.flow_screen ?? ""}
        onChange={(v) => onUpdateConfig({ flow_screen: v })}
        rows={1}
      />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Variable key (stored in flow_runs.vars)
        </label>
        <Input
          value={cfg.var_key ?? ""}
          onChange={(e) =>
            onUpdateConfig({
              var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
            })
          }
          placeholder="e.g. form, lead_details"
          className="bg-muted font-mono text-xs"
        />
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="After form is submitted, advance to"
      />
    </>
  );
}

// ============================================================
// condition
// ============================================================

interface ConditionCfg {
  subject?: "var" | "tag" | "contact_field" | "shopify_payment";
  subject_key?: string;
  operator?: "equals" | "not_equals" | "contains" | "present" | "absent";
  value?: string;
  true_next?: string;
  false_next?: string;
}

interface SwitchBranchCfg {
  branch_id: string;
  label: string;
  subject?: ConditionCfg["subject"];
  subject_key?: string;
  operator?: ConditionCfg["operator"];
  value?: string;
  next_node_key?: string;
}

interface SwitchCfg {
  branches?: SwitchBranchCfg[];
  default_next?: string;
}

function collectFlowVarKeys(nodes: BuilderNode[]): string[] {
  const keys = new Set<string>();
  for (const n of nodes) {
    if (n.node_type !== "collect_input" && n.node_type !== "send_address" && n.node_type !== "send_flow") {
      continue;
    }
    const key = (n.config as { var_key?: string }).var_key?.trim();
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

function uniqueSwitchBranchId(
  branches: SwitchBranchCfg[],
  label: string,
): string {
  const base = slugify(label, "case");
  const taken = new Set(branches.map((b) => b.branch_id));
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

function ConditionPredicateFields({
  cfg,
  allNodes,
  onPatch,
}: {
  cfg: Pick<ConditionCfg, "subject" | "subject_key" | "operator" | "value">;
  allNodes: BuilderNode[];
  onPatch: (patch: Partial<ConditionCfg>) => void;
}) {
  const tags = useUserTags();
  const varKeys = collectFlowVarKeys(allNodes);
  const subject = cfg.subject ?? "var";
  const operator = cfg.operator ?? "equals";
  const showValue =
    operator === "equals" ||
    operator === "not_equals" ||
    operator === "contains";
  const isShopifyPayment = subject === "shopify_payment";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">If</label>
          <Select
            value={subject}
            onValueChange={(v) => {
              const next = v as ConditionCfg["subject"];
              if (next === "shopify_payment") {
                onPatch({
                  subject: next,
                  subject_key: "payment_status",
                  operator: "equals",
                  value: cfg.value || "paid",
                });
              } else {
                onPatch({ subject: next });
              }
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="var">Captured variable</SelectItem>
              <SelectItem value="shopify_payment">Shopify payment status</SelectItem>
              <SelectItem value="tag">Contact has tag</SelectItem>
              <SelectItem value="contact_field">Contact field</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs text-muted-foreground">
            {isShopifyPayment
              ? "Payment status"
              : subject === "var"
                ? "Variable"
                : subject === "tag"
                  ? "Tag"
                  : "Field"}
          </label>
          {isShopifyPayment ? (
            <Select
              value={cfg.value ?? "paid"}
              onValueChange={(v) =>
                onPatch({ value: v ?? undefined, operator: "equals" })
              }
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOPIFY_PAYMENT_STATUSES.filter((ps) => ps !== "any").map((ps) => (
                  <SelectItem key={ps} value={ps}>
                    {SHOPIFY_PAYMENT_STATUS_LABELS[ps]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : subject === "tag" && tags.length > 0 ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onPatch({ subject_key: v ?? undefined })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a tag…" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : subject === "contact_field" ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onPatch({ subject_key: v ?? undefined })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a field…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">name</SelectItem>
                <SelectItem value="email">email</SelectItem>
                <SelectItem value="phone">phone</SelectItem>
                <SelectItem value="company">company</SelectItem>
              </SelectContent>
            </Select>
          ) : subject === "var" && varKeys.length > 0 ? (
            <Select
              value={cfg.subject_key ?? ""}
              onValueChange={(v) => onPatch({ subject_key: v ?? undefined })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a variable…" />
              </SelectTrigger>
              <SelectContent>
                {varKeys.map((key) => (
                  <SelectItem key={key} value={key}>
                    vars.{key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.subject_key ?? ""}
              onChange={(e) => onPatch({ subject_key: e.target.value })}
              placeholder={subject === "var" ? "e.g. email" : "tag UUID"}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          showValue && !isShopifyPayment ? "md:grid-cols-2" : "",
        )}
      >
        {!isShopifyPayment && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Operator
            </label>
            <Select
              value={operator}
              onValueChange={(v) => {
                if (v) onPatch({ operator: v as ConditionCfg["operator"] });
              }}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="present">is present</SelectItem>
                <SelectItem value="absent">is absent</SelectItem>
                <SelectItem value="equals">equals</SelectItem>
                <SelectItem value="not_equals">does not equal</SelectItem>
                <SelectItem value="contains">contains</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {showValue && !isShopifyPayment && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Value
            </label>
            <Input
              value={cfg.value ?? ""}
              onChange={(e) => onPatch({ value: e.target.value })}
              className="bg-muted"
            />
          </div>
        )}
      </div>
    </>
  );
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function ConditionForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <ConditionPredicateFields
        cfg={cfg}
        allNodes={allNodes}
        onPatch={(patch) => onUpdateConfig(patch)}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label="If true → advance to"
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label="If false → advance to"
        />
      </div>
    </>
  );
}

function SwitchForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SwitchCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const branches = cfg.branches ?? [];

  const updateBranch = (index: number, patch: Partial<SwitchBranchCfg>) => {
    onUpdateConfig({
      branches: branches.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    });
  };

  const removeBranch = (index: number) => {
    onUpdateConfig({
      branches: branches.filter((_, i) => i !== index),
    });
  };

  const addBranch = () => {
    const label = `Case ${branches.length + 1}`;
    onUpdateConfig({
      branches: [
        ...branches,
        {
          branch_id: uniqueSwitchBranchId(branches, label),
          label,
          subject: "var",
          subject_key: "",
          operator: "equals",
          value: "",
          next_node_key: "",
        },
      ],
    });
  };

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Branches are checked top to bottom. The first match wins; otherwise the
        flow follows the else branch.
      </p>
      <div className="flex flex-col gap-4">
        {branches.map((branch, index) => (
          <div
            key={branch.branch_id || index}
            className="rounded-lg border border-border bg-muted/30 p-3"
          >
            <div className="mb-3 flex items-center gap-2">
              <Input
                value={branch.label}
                onChange={(e) => {
                  const label = e.target.value;
                  updateBranch(index, {
                    label,
                    branch_id: branch.branch_id || uniqueSwitchBranchId(branches, label),
                  });
                }}
                placeholder="Branch label"
                className="bg-muted text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-red-400"
                onClick={() => removeBranch(index)}
                disabled={branches.length <= 1}
                aria-label="Remove branch"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <ConditionPredicateFields
                cfg={branch}
                allNodes={allNodes}
                onPatch={(patch) => updateBranch(index, patch)}
              />
              <NextNodeRow
                value={branch.next_node_key ?? ""}
                allNodes={allNodes}
                currentKey={currentKey}
                onChange={(v) => updateBranch(index, { next_node_key: v })}
                label="Then advance to"
              />
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-border"
        onClick={addBranch}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add branch
      </Button>
      <NextNodeRow
        value={cfg.default_next ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ default_next: v })}
        label="Else → advance to"
      />
    </>
  );
}

// ============================================================
// create_deal
// ============================================================

interface PipelineRow {
  id: string;
  name: string;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  name: string;
}

interface CreateDealCfg {
  pipeline_id?: string;
  stage_id?: string;
  title?: string;
  value?: number;
  next_node_key?: string;
}

function CreateDealForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: CreateDealCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { pipelines, stages, loaded } = useAccountPipelines();
  const pipelineId = cfg.pipeline_id ?? "";
  const stageId = cfg.stage_id ?? "";
  const stagesForPipeline = pipelineId
    ? stages.filter((s) => s.pipeline_id === pipelineId)
    : [];

  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        Creates a deal on the contact in the selected sales pipeline, at the
        chosen lead stage.
      </p>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Sales pipeline
        </label>
        {!loaded ? (
          <p className="text-xs text-muted-foreground">Loading pipelines…</p>
        ) : pipelines.length > 0 ? (
          <Select
            value={pipelineId || undefined}
            onValueChange={(v) => {
              if (!v) return;
              onUpdateConfig({
                pipeline_id: v,
                stage_id: stages.some(
                  (s) => s.pipeline_id === v && s.id === stageId,
                )
                  ? stageId
                  : "",
              });
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder="Pick a pipeline…" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              {pipelineId && !pipelines.some((p) => p.id === pipelineId) && (
                <SelectItem value={pipelineId}>Unknown pipeline</SelectItem>
              )}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={pipelineId}
            onChange={(e) =>
              onUpdateConfig({ pipeline_id: e.target.value, stage_id: "" })
            }
            placeholder="Pipeline UUID — or create one under Pipelines"
            className="bg-muted font-mono text-xs"
          />
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Lead stage
        </label>
        {!loaded ? (
          <p className="text-xs text-muted-foreground">Loading stages…</p>
        ) : stagesForPipeline.length > 0 ? (
          <Select
            value={stageId || undefined}
            onValueChange={(v) => {
              if (v) onUpdateConfig({ stage_id: v });
            }}
          >
            <SelectTrigger className="bg-muted">
              <SelectValue placeholder="Pick a lead stage…" />
            </SelectTrigger>
            <SelectContent>
              {stagesForPipeline.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
              {stageId &&
                !stagesForPipeline.some((s) => s.id === stageId) && (
                  <SelectItem value={stageId}>Unknown stage</SelectItem>
                )}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={stageId}
            onChange={(e) => onUpdateConfig({ stage_id: e.target.value })}
            placeholder={
              pipelineId
                ? "Stage UUID"
                : "Pick a sales pipeline first"
            }
            disabled={!pipelineId}
            className="bg-muted font-mono text-xs"
          />
        )}
      </div>
      <TextRow
        label="Deal title (supports {{vars.x}})"
        value={cfg.title ?? ""}
        onChange={(v) => onUpdateConfig({ title: v })}
      />
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Value (optional)
        </label>
        <Input
          type="number"
          min={0}
          value={cfg.value ?? 0}
          onChange={(e) => {
            const n = Number(e.target.value);
            onUpdateConfig({ value: Number.isFinite(n) ? n : 0 });
          }}
          className="bg-muted"
        />
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="Advances to"
      />
    </>
  );
}

function useAccountPipelines(): {
  pipelines: PipelineRow[];
  stages: StageRow[];
  loaded: boolean;
} {
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const [pipesRes, stagesRes] = await Promise.all([
        supabase.from("pipelines").select("id, name").order("name"),
        supabase
          .from("pipeline_stages")
          .select("id, pipeline_id, name")
          .order("position"),
      ]);
      if (cancelled) return;
      setPipelines((pipesRes.data as PipelineRow[] | null) ?? []);
      setStages((stagesRes.data as StageRow[] | null) ?? []);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { pipelines, stages, loaded };
}

// ============================================================
// set_tag
// ============================================================

interface SetTagCfg {
  mode?: "add" | "remove";
  tag_id?: string;
  next_node_key?: string;
}

function SetTagForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const tags = useUserTags();

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Action</label>
          <Select
            value={cfg.mode ?? "add"}
            onValueChange={(v) =>
              onUpdateConfig({ mode: v as SetTagCfg["mode"] })
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="add">Add tag</SelectItem>
              <SelectItem value="remove">Remove tag</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tag</label>
          {tags.length > 0 ? (
            <Select
              value={cfg.tag_id ?? ""}
              onValueChange={(v) => onUpdateConfig({ tag_id: v })}
            >
              <SelectTrigger className="bg-muted">
                <SelectValue placeholder="Pick a tag…" />
              </SelectTrigger>
              <SelectContent>
                {tags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.tag_id ?? ""}
              onChange={(e) => onUpdateConfig({ tag_id: e.target.value })}
              placeholder="Tag UUID"
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>
      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="Then advance to"
      />
    </>
  );
}

/**
 * Shared loader for both `condition` (subject=tag) and `set_tag`.
 * Falls back to raw UUID input if the endpoint is absent on older
 * deployments — the form remains authorable in that case.
 */
function useUserTags(): UserTag[] {
  const [tags, setTags] = useState<UserTag[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tags").catch(() => null);
        if (!res || !res.ok) return;
        const json = (await res.json()) as { tags?: UserTag[] };
        if (!cancelled) setTags(json.tags ?? []);
      } catch {
        // Tags endpoint absent — caller falls back to raw input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return tags;
}

// ============================================================
// send_media
// ============================================================

interface SendMediaCfg {
  media_type?: "image" | "video" | "document";
  media_url?: string;
  caption?: string;
  filename?: string;
  next_node_key?: string;
}

// Mirrors the bucket's allowed_mime_types from migration 016. Kept in
// sync with the storage policy so the picker rejects unsupported files
// before they hit the network rather than failing with a confusing
// Supabase RLS / mime-type error.
const MEDIA_ACCEPT: Record<NonNullable<SendMediaCfg["media_type"]>, string> = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/3gpp",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

const FLOW_MEDIA_BUCKET = "flow-media";

function SendMediaForm({
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  cfg: SendMediaCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const mediaType = cfg.media_type ?? "image";
  const isDocument = mediaType === "document";
  const displayName =
    cfg.filename ||
    (cfg.media_url ? cfg.media_url.split("/").pop() ?? "" : "");

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MEDIA_MAX_BYTES) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 16 MB.`,
        );
        return;
      }
      setUploading(true);
      try {
        // Account-scoped upload (path `account-<id>/...`) — see
        // uploadAccountMedia + migration 020's flow-media RLS policy.
        const { publicUrl } = await uploadAccountMedia(FLOW_MEDIA_BUCKET, file);
        // Patch all fields in one call so the form doesn't re-render
        // with a half-uploaded state.
        onUpdateConfig({
          media_url: publicUrl,
          filename: file.name,
        });
        toast.success("File uploaded.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [onUpdateConfig],
  );

  const handleClear = () => {
    onUpdateConfig({ media_url: "", filename: "" });
  };

  return (
    <>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Media type</label>
        <Select
          value={mediaType}
          onValueChange={(v) => {
            // Changing type clears the existing file — the bucket
            // accepts different MIME sets per type and a previously
            // uploaded PDF can't be sent as an image.
            onUpdateConfig({
              media_type: v as NonNullable<SendMediaCfg["media_type"]>,
              media_url: "",
              filename: "",
            });
          }}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="image">Image (PNG, JPEG, WebP)</SelectItem>
            <SelectItem value="video">Video (MP4, 3GP)</SelectItem>
            <SelectItem value="document">
              Document (PDF, Word, Excel, PowerPoint, TXT)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">File</label>
        {cfg.media_url ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
            <a
              href={cfg.media_url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-foreground hover:text-cyan-300"
              title={displayName || cfg.media_url}
            >
              {displayName || cfg.media_url}
            </a>
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Remove file"
              disabled={uploading}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-4 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                Click to upload (max 16 MB)
              </>
            )}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT[mediaType]}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      <TextRow
        label="Caption (optional, shown under the media)"
        value={cfg.caption ?? ""}
        onChange={(v) => onUpdateConfig({ caption: v })}
        rows={2}
      />

      {isDocument && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Filename shown to the customer (documents only)
          </label>
          <Input
            value={cfg.filename ?? ""}
            onChange={(e) => onUpdateConfig({ filename: e.target.value })}
            placeholder="invoice.pdf"
            className="bg-muted text-xs"
          />
        </div>
      )}

      <NextNodeRow
        value={cfg.next_node_key ?? ""}
        allNodes={allNodes}
        currentKey={currentKey}
        onChange={(v) => onUpdateConfig({ next_node_key: v })}
        label="After sending, advance to"
      />
    </>
  );
}
