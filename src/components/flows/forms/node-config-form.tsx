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
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Paperclip,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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
import { ProductPicker } from "@/components/catalog/product-picker";
import {
  DEFAULT_CAROUSEL_INTRO,
  DEFAULT_COLLECTION_PRODUCTS,
  MAX_SEND_PRODUCTS,
} from "@/lib/shopify/send-product-constants";
import { DEFAULT_PRODUCT_BUTTON_LABELS } from "@/lib/shopify/product-checkout-url";
import { uploadAccountMedia, MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";
import { slugify, type BuilderNode } from "../shared";
import {
  nodeTypeHasReplyTimeoutSlot,
  hasReplyTimeoutTiming,
  showReplyTimeoutHandle,
} from "@/lib/flows/reply-timeout";
import { NextNodeRow, NodeKeySelect, TextRow, UpdateContactFieldsForm, NodeVariableGroups } from "./fields";
import { SendTemplateFields } from "@/components/shared/send-template-fields";
import { templateVariableGroupsForFlow } from "@/lib/flows/template-variables";
import {
  resolvePipelineLabel,
  resolveStageLabel,
} from "@/lib/pipelines";
import type { TemplateQuickReplyButton } from "@/lib/flows/template-buttons";
import { isShopifyFulfillmentFlowTrigger, isShopifyCheckoutAbandonmentFlowTrigger, isShopifyOrderFlowTrigger, type FlowTriggerType } from "@/lib/flows/trigger-types";
import { useAccountPipelines } from "./use-account-pipelines";
import { CollectPaymentFields } from "./collect-payment-fields";
import { SendFlowFields, type SendFlowCfg as SendFlowFieldsCfg } from "./send-flow-fields";
import { formConditionSources, formFieldVariableGroups, type FormConditionSource } from "@/lib/flows/form-variables";
import { ConditionRuleFields } from "./condition-fields";
import type { ConditionNodeConfig } from "@/lib/flows/types";

/**
 * Variables offered in text fields. Shopify flows get their full trigger
 * set; every flow gets contact attributes, fallbacks and captured form fields.
 */
function nodeVariableGroups(
  allNodes: BuilderNode[],
  currentKey: string,
  triggerType?: FlowTriggerType,
  triggerConfig?: Record<string, unknown>,
) {
  const base = templateVariableGroupsForFlow(triggerType, triggerConfig);
  const groups = triggerType?.startsWith("shopify_")
    ? base
    : base.filter((g) => g.id === "contact" || g.id === "fallback");
  return [...groups, ...formFieldVariableGroups(allNodes, currentKey)];
}

interface NodeConfigFormProps {
  templateLayout?: boolean;
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
  templateLayout,
}: NodeConfigFormProps) {
  return (
    <>
      <NodeVariableGroups.Provider value={nodeVariableGroups(allNodes, node.node_key, triggerType, triggerConfig)}>
      <NodeConfigBody
        node={node}
        allNodes={allNodes}
        showAdvanced={showAdvanced}
        onUpdateConfig={onUpdateConfig}
        triggerType={triggerType}
        triggerConfig={triggerConfig}
        templateLayout={templateLayout}
      />
      </NodeVariableGroups.Provider>
      {nodeTypeHasReplyTimeoutSlot(node.node_type) && !(templateLayout && node.node_type === "send_template") ? (
        <ReplyTimeoutSection cfg={node.config} onUpdateConfig={onUpdateConfig} />
      ) : null}
    </>
  );
}

function NodeConfigBody({
  node,
  allNodes,
  showAdvanced,
  onUpdateConfig,
  triggerType,
  triggerConfig,
  templateLayout,
}: NodeConfigFormProps) {
  const t = useTranslations("Flows.builder.form");
  const cfg = node.config;
  switch (node.node_type) {
    case "collect_payment":
      return <CollectPaymentFields node={node} allNodes={allNodes} onChange={onUpdateConfig} triggerType={triggerType} triggerConfig={triggerConfig} />;
    case "start":
      return null;

    case "send_message":
      return (
        <>
          <TextRow
            label={t("textToCustomer")}
            value={(cfg as { text?: string }).text ?? ""}
            onChange={(v) => onUpdateConfig({ text: v })}
            rows={4}
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
          t={t}
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
          t={t}
        />
      );

    case "send_media":
      return (
        <SendMediaForm
          cfg={cfg as SendMediaCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "send_product":
      return (
        <SendProductForm
          cfg={cfg as SendProductCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
        />
      );

    case "collect_input":
      return (
        <>
          <TextRow
            label={t("promptToCustomer")}
            value={(cfg as { prompt_text?: string }).prompt_text ?? ""}
            onChange={(v) => onUpdateConfig({ prompt_text: v })}
            rows={2}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("varKeyLabel")}
            </label>
            <Input
              value={(cfg as { var_key?: string }).var_key ?? ""}
              onChange={(e) =>
                onUpdateConfig({
                  var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                })
              }
              placeholder={t("varKeyPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("varKeyHelp")}{" "}
              <code className="rounded bg-muted px-1">
                {"{{vars."}
                {(cfg as { var_key?: string }).var_key || "name"}
                {"}}"}
              </code>
              .
            </p>
          </div>
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
          triggerType={triggerType}
          cfg={cfg as ConditionCfg}
          allNodes={allNodes}
          currentKey={node.node_key}
          onUpdateConfig={onUpdateConfig}
          t={t}
        />
      );

    case "switch":
      return (
        <SwitchForm
          triggerType={triggerType}
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
          t={t}
        />
      );

    case "handoff":
      return (
        <TextRow
          label={t("internalNote")}
          value={(cfg as { note?: string }).note ?? ""}
          onChange={(v) => onUpdateConfig({ note: v })}
          rows={2}
        />
      );

    case "send_template":
      return (
        <>
          <SendTemplateFields
            flowLayout={templateLayout}
            additionalFields={templateLayout ? <ReplyTimeoutSection cfg={cfg} onUpdateConfig={onUpdateConfig} /> : undefined}
            creationPurpose={triggerType && isShopifyFulfillmentFlowTrigger(triggerType) ? "tracking" : triggerType && isShopifyCheckoutAbandonmentFlowTrigger(triggerType) ? "checkout" : triggerType && isShopifyOrderFlowTrigger(triggerType) ? "order_status" : "custom"}
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
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Wait for
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={String((cfg as { amount?: number }).amount ?? 1)}
                  onChange={(e) =>
                    onUpdateConfig({
                      amount: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-20 bg-muted"
                />
                <Select
                  value={(cfg as { unit?: string }).unit ?? "hours"}
                  onValueChange={(v) => onUpdateConfig({ unit: v })}
                >
                  <SelectTrigger className="w-[120px] bg-muted">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seconds">Seconds</SelectItem>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
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
        </>
      );

    case "update_contact_field":
      return (
        <>
          <UpdateContactFieldsForm cfg={cfg} onUpdateConfig={onUpdateConfig} />
        </>
      );

    case "assign_conversation":
    case "close_conversation":
      return null;

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
          {t("endNodeHelp")}
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
  t,
}: {
  cfg: SendButtonsCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
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
        label={t("bodyText")}
        value={cfg.text ?? ""}
        onChange={(v) => onUpdateConfig({ text: v })}
        rows={3}
      />
      <TextRow
        label={t("footerText")}
        value={cfg.footer_text ?? ""}
        onChange={(v) => onUpdateConfig({ footer_text: v })}
      />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs text-muted-foreground">
            {t("buttonsHelp")}
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
                placeholder={t("optionTitlePlaceholder")}
                className="bg-muted"
                maxLength={20}
              />
              <NodeKeySelect
                value={b.next_node_key || null}
                nodes={allNodes}
                excludeKey={currentKey}
                onChange={(v) => updateButton(i, { next_node_key: v ?? "" })}
                placeholder={t("nextNodePlaceholder")}
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
            {t("addButton")}
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
  t,
}: {
  cfg: SendListCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  showAdvanced: boolean;
  t: ReturnType<typeof useTranslations>;
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
          label={t("buttonLabel")}
          value={cfg.button_label ?? ""}
          onChange={(v) => onUpdateConfig({ button_label: v })}
        />
        <TextRow
          label={t("footerText")}
          value={cfg.footer_text ?? ""}
          onChange={(v) => onUpdateConfig({ footer_text: v })}
        />
      </div>

      <div className="mt-2">
        <label className="mb-2 block text-xs text-muted-foreground">
          {t("rowsHelp")}
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
                placeholder={t("sectionTitlePlaceholder", { count: sIdx + 1 })}
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
                  placeholder={t("rowTitlePlaceholder")}
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
                  placeholder={t("nextNodePlaceholder")}
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
                {t("addRow")}
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
            {t("addSection")}
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
    </>
  );
}

// ============================================================
// send_flow
// ============================================================

type SendFlowCfg = ReplyTimeoutCfg & SendFlowFieldsCfg;

function SendFlowForm(props: {
  cfg: SendFlowCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  return <SendFlowFields {...props} />;
}

// ============================================================
// condition
// ============================================================

type ConditionCfg = Partial<ConditionNodeConfig>;

interface SwitchBranchCfg extends ConditionCfg {
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

/** Latest field list per Meta Flow id, so older nodes pick up answer choices. */
const formFieldsCache = new Map<string, Promise<FormConditionSource["fields"] | null>>();

function useFormConditionSources(allNodes: BuilderNode[], currentKey: string): FormConditionSource[] {
  const sources = formConditionSources(allNodes, currentKey);
  const [fresh, setFresh] = useState<Record<string, FormConditionSource["fields"]>>({});
  const flowIds = [...new Set(sources.map((s) => s.flow_id).filter((id): id is string => !!id))].join(",");
  useEffect(() => {
    let alive = true;
    for (const id of flowIds ? flowIds.split(",") : []) {
      if (!formFieldsCache.has(id)) {
        formFieldsCache.set(
          id,
          fetch(`/api/whatsapp/flows/${encodeURIComponent(id)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((d: { fields?: FormConditionSource["fields"] } | null) => (Array.isArray(d?.fields) ? d.fields : null))
            .catch(() => null),
        );
      }
      void formFieldsCache.get(id)!.then((fields) => {
        if (alive && fields?.length) setFresh((prev) => (prev[id] === fields ? prev : { ...prev, [id]: fields }));
      });
    }
    return () => {
      alive = false;
    };
  }, [flowIds]);
  return sources.map((s) => (s.flow_id && fresh[s.flow_id] ? { ...s, fields: fresh[s.flow_id]! } : s));
}

function ConditionPredicateFields({ cfg, allNodes, currentKey, onPatch, triggerType }: {
  cfg: ConditionCfg; allNodes: BuilderNode[]; currentKey: string; onPatch: (patch: Partial<ConditionCfg>) => void; triggerType?: FlowTriggerType;
}) {
  const tags = useUserTags();
  const forms = useFormConditionSources(allNodes, currentKey);
  return <ConditionRuleFields cfg={cfg} onPatch={onPatch} triggerType={triggerType} tags={tags} varKeys={collectFlowVarKeys(allNodes)} forms={forms} />;
}

interface UserTag {
  id: string;
  name: string;
  color?: string;
}

function ConditionForm({
  triggerType,
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
  t,
}: {
  triggerType?: FlowTriggerType;
  cfg: ConditionCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      <ConditionPredicateFields
        triggerType={triggerType}
        cfg={cfg}
        allNodes={allNodes}
        currentKey={currentKey}
        onPatch={(patch) => onUpdateConfig(patch)}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextNodeRow
          value={cfg.true_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ true_next: v })}
          label={t("ifTrueAdvance")}
        />
        <NextNodeRow
          value={cfg.false_next ?? ""}
          allNodes={allNodes}
          currentKey={currentKey}
          onChange={(v) => onUpdateConfig({ false_next: v })}
          label={t("ifFalseAdvance")}
        />
      </div>
    </>
  );
}

function SwitchForm({
  triggerType,
  cfg,
  allNodes,
  currentKey,
  onUpdateConfig,
}: {
  triggerType?: FlowTriggerType;
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
          subject: triggerType?.startsWith('shopify_') ? triggerType.includes('checkout') ? 'shopify_checkout' : 'shopify_order' : 'var',
          subject_key: triggerType?.startsWith('shopify_') ? triggerType.includes('checkout') ? 'total' : 'payment_status' : '',
          operator: "equals",
          value: triggerType?.startsWith('shopify_order_') ? 'paid' : '',
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
        triggerType={triggerType}
                cfg={branch}
                allNodes={allNodes}
                currentKey={currentKey}
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

interface CreateDealCfg {
  pipeline_id?: string;
  stage_id?: string;
  title?: string;
  value?: number;
  next_node_key?: string;
}

function CreateDealForm({
  cfg,
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
  const pipelineLabel = resolvePipelineLabel(pipelineId, pipelines, {
    loading: !loaded,
  });
  const stageLabel = resolveStageLabel(stageId, stagesForPipeline, {
    loading: !loaded,
  });

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
            <SelectTrigger className="bg-muted w-full">
              <SelectValue placeholder="Pick a pipeline…">
                {pipelineId ? pipelineLabel : undefined}
              </SelectValue>
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
            <SelectTrigger className="bg-muted w-full">
              <SelectValue placeholder="Pick a lead stage…">
                {stageId ? stageLabel : undefined}
              </SelectValue>
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
    </>
  );
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
  onUpdateConfig,
  t,
}: {
  cfg: SetTagCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tags = useUserTags();

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("actionLabel")}</label>
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
              <SelectItem value="add">{t("addTag")}</SelectItem>
              <SelectItem value="remove">{t("removeTag")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("tagLabel")}</label>
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
              placeholder={t("tagUuidPlaceholder")}
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
      </div>
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
  onUpdateConfig,
  t,
}: {
  cfg: SendMediaCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
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
        <label className="mb-1 block text-xs text-muted-foreground">{t("mediaTypeLabel")}</label>
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
            <SelectItem value="image">{t("imageLabel")}</SelectItem>
            <SelectItem value="video">{t("videoLabel")}</SelectItem>
            <SelectItem value="document">
              {t("documentLabel")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">{t("fileLabel")}</label>
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
              aria-label={t("removeFile")}
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
                {t("uploading")}
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                {t("clickToUpload")}
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
        label={t("captionLabel")}
        value={cfg.caption ?? ""}
        onChange={(v) => onUpdateConfig({ caption: v })}
        rows={2}
      />

      {isDocument && (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {t("filenameLabel")}
          </label>
          <Input
            value={cfg.filename ?? ""}
            onChange={(e) => onUpdateConfig({ filename: e.target.value })}
            placeholder={t("filenamePlaceholder")}
            className="bg-muted text-xs"
          />
        </div>
      )}

    </>
  );
}

// ============================================================
// send_product
// ============================================================

interface PickedProduct {
  shopify_variant_id: string;
  title: string;
  variant_title?: string | null;
  price?: string;
  currency?: string | null;
  image_url?: string | null;
}

interface SendProductCfg {
  product_source?: "fixed" | "collection" | "variable";
  shopify_variant_id?: string | number;
  product_title?: string;
  product_variant_title?: string | null;
  product_price?: string;
  product_currency?: string | null;
  product_image_url?: string | null;
  products?: PickedProduct[];
  collection_id?: string;
  collection_title?: string;
  max_products?: number;
  variant_id_var?: string;
  quantity?: number;
  message_text?: string;
  button_label?: string;
  link_target?: "checkout" | "product_page";
  next_node_key?: string;
}

interface SellOnWhatsAppStatus {
  connected: boolean;
  enabled: boolean;
  active_product_count: number;
  products_last_synced_at: string | null;
}

interface CollectionOption {
  id: number;
  title: string;
  kind: "custom" | "smart";
}

const PRODUCT_BUTTON_MAX = 20;

function formatProductPrice(price: string | undefined, currency: string | null | undefined) {
  const normalized = price?.trim() || "0.00";
  if (currency === "INR") return `₹${normalized}`;
  return currency ? `${currency} ${normalized}` : normalized;
}

function productVariantLabel(variantTitle: string | null | undefined) {
  const trimmed = variantTitle?.trim();
  return trimmed && trimmed.toLowerCase() !== "default title" ? trimmed : null;
}

/** Picked products, falling back to the legacy single-product fields. */
function pickedProducts(cfg: SendProductCfg): PickedProduct[] {
  if (cfg.products?.length) return cfg.products;
  if (cfg.shopify_variant_id == null || String(cfg.shopify_variant_id).trim() === "") return [];
  return [
    {
      shopify_variant_id: String(cfg.shopify_variant_id),
      title: cfg.product_title ?? "",
      variant_title: cfg.product_variant_title,
      price: cfg.product_price,
      currency: cfg.product_currency,
      image_url: cfg.product_image_url,
    },
  ];
}

/** Writes the list plus the legacy single-product fields (first item). */
function productsPatch(list: PickedProduct[]): Record<string, unknown> {
  const first = list[0];
  return {
    products: list,
    shopify_variant_id: first?.shopify_variant_id ?? "",
    product_title: first?.title ?? "",
    product_variant_title: first?.variant_title ?? null,
    product_price: first?.price ?? "",
    product_currency: first?.currency ?? null,
    product_image_url: first?.image_url ?? null,
  };
}

const SOURCE_LABELS: Record<"fixed" | "collection" | "variable", string> = {
  fixed: "Pick products",
  collection: "A Shopify collection",
  variable: "From a flow variable",
};

function SendProductForm({
  cfg,
  onUpdateConfig,
}: {
  cfg: SendProductCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState<SellOnWhatsAppStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [collections, setCollections] = useState<CollectionOption[] | null>(null);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState("");
  const [collectionPreview, setCollectionPreview] = useState<PickedProduct[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const source = cfg.product_source === "variable" || cfg.product_source === "collection"
    ? cfg.product_source
    : "fixed";
  const picked = pickedProducts(cfg);
  const maxProducts = cfg.max_products ?? DEFAULT_COLLECTION_PRODUCTS;
  const buttonLabel = cfg.button_label ?? "";
  const collectionId = cfg.collection_id ?? "";

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/shopify/sell-on-whatsapp", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not load Shopify status");
      setStatus(payload as SellOnWhatsAppStatus);
      setStatusError("");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    setCollectionsError("");
    try {
      const res = await fetch("/api/shopify/collections", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not load collections");
      setCollections((payload.collections ?? []) as CollectionOption[]);
    } catch (err) {
      setCollectionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setCollectionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (source === "collection" && collections === null) void loadCollections();
  }, [source, collections, loadCollections]);

  useEffect(() => {
    if (source !== "collection" || !collectionId) {
      setCollectionPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void fetch(
      `/api/shopify/collections/${encodeURIComponent(collectionId)}/products?limit=${maxProducts}`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        setCollectionPreview(
          res.ok
            ? ((payload.products ?? []) as Array<PickedProduct & { shopify_variant_id: number }>).map(
                (p) => ({ ...p, shopify_variant_id: String(p.shopify_variant_id) }),
              )
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setCollectionPreview([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, collectionId, maxProducts]);

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/shopify/products/sync", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Product sync failed");
      toast.success(`Synced ${payload.upserted ?? 0} products from Shopify`);
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Product sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const moveProduct = (index: number, delta: number) => {
    const next = [...picked];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onUpdateConfig(productsPatch(next));
  };

  const blocker = statusError
    ? statusError
    : status && !status.connected
      ? "Shopify isn't connected for this workspace."
      : status && !status.enabled
        ? "Sell on WhatsApp is turned off, so product cards won't send until it's enabled."
        : null;

  // What the preview (and the customer) will see.
  const previewItems: PickedProduct[] =
    source === "fixed"
      ? picked.length > 1
        ? picked.filter((p) => p.image_url)
        : picked
      : source === "collection"
        ? (collectionPreview ?? [])
        : [];
  const isCarousel =
    source === "fixed"
      ? previewItems.length > 1
      : source === "collection"
        ? maxProducts > 1 && (collectionPreview === null || previewItems.length > 1)
        : false;
  const introText = cfg.message_text?.trim() || (isCarousel ? DEFAULT_CAROUSEL_INTRO : "");
  const linkTarget = cfg.link_target === "product_page" ? "product_page" : "checkout";
  const defaultLabel = DEFAULT_PRODUCT_BUTTON_LABELS[linkTarget];
  const ctaLabel = buttonLabel.trim() || defaultLabel;

  return (
    <>
      <p className="text-[11px] text-muted-foreground">
        Sends products from your Shopify catalog with a button that opens either
        checkout with the item in the cart or the product&apos;s page on your
        store. One product goes out as a single
        card; 2–{MAX_SEND_PRODUCTS} go out as a swipeable carousel. The flow then
        moves straight on to the next step.
      </p>

      {blocker ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{blocker}</span>
          </p>
          <a
            href="/settings?tab=shopify"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 underline"
          >
            Open Shopify settings <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Products to send
        </label>
        <Select
          value={source}
          onValueChange={(v) => {
            if (v) onUpdateConfig({ product_source: v });
          }}
        >
          <SelectTrigger className="w-full bg-muted text-xs">
            <SelectValue>{SOURCE_LABELS[source]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">{SOURCE_LABELS.fixed}</SelectItem>
            <SelectItem value="collection">{SOURCE_LABELS.collection}</SelectItem>
            <SelectItem value="variable">{SOURCE_LABELS.variable}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {source === "fixed" ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs text-muted-foreground">
              Products ({picked.length}/{MAX_SEND_PRODUCTS})
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => void syncCatalog()}
              disabled={syncing}
            >
              <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
              Sync catalog
            </Button>
          </div>
          {picked.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border bg-muted/40">
              {picked.map((product, index) => {
                const variantLabel = productVariantLabel(product.variant_title);
                const skipped = picked.length > 1 && !product.image_url;
                return (
                  <li key={product.shopify_variant_id} className="flex items-center gap-2 p-2">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="size-full object-cover" />
                      ) : (
                        <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {product.title || `Variant ${product.shopify_variant_id}`}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[variantLabel, product.price ? formatProductPrice(product.price, product.currency) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {skipped ? (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">
                          No image, so it&apos;s left out of the carousel
                        </p>
                      ) : null}
                    </div>
                    {picked.length > 1 ? (
                      <div className="flex flex-col">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          onClick={() => moveProduct(index, -1)}
                          disabled={index === 0}
                          aria-label="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          onClick={() => moveProduct(index, 1)}
                          disabled={index === picked.length - 1}
                          aria-label="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onUpdateConfig(productsPatch(picked.filter((_, i) => i !== index)))}
                      aria-label="Remove product"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start gap-2 text-xs",
              picked.length === 0 ? "h-auto border-dashed py-3" : "mt-2 h-8",
            )}
            onClick={() => setPickerOpen(true)}
            disabled={picked.length >= MAX_SEND_PRODUCTS}
          >
            {picked.length === 0 ? <ShoppingBag className="h-4 w-4" /> : <Plus className="h-3.5 w-3.5" />}
            {picked.length === 0 ? "Choose a product" : "Add another product"}
          </Button>
          {status ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {status.active_product_count} active product
              {status.active_product_count === 1 ? "" : "s"} in your synced catalog
              {status.products_last_synced_at
                ? `, last synced ${new Date(status.products_last_synced_at).toLocaleString()}`
                : ", never synced"}
              . Out-of-stock items can&apos;t be picked.
            </p>
          ) : null}
          <ProductPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onSelect={(product) => {
              const id = String(product.shopify_variant_id);
              if (picked.some((p) => p.shopify_variant_id === id)) {
                toast.info("That product is already in the list");
                return;
              }
              onUpdateConfig(
                productsPatch([
                  ...picked,
                  {
                    shopify_variant_id: id,
                    title: product.title,
                    variant_title: product.variant_title,
                    price: product.price,
                    currency: product.currency,
                    image_url: product.image_url,
                  },
                ]),
              );
            }}
          />
        </div>
      ) : source === "collection" ? (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs text-muted-foreground">Collection</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => void loadCollections()}
                disabled={collectionsLoading}
                aria-label="Refresh collections"
              >
                <RefreshCw className={cn("h-3 w-3", collectionsLoading && "animate-spin")} />
              </Button>
            </div>
            <Select
              value={collectionId || undefined}
              onValueChange={(id) => {
                if (!id) return;
                const match = collections?.find((c) => String(c.id) === id);
                onUpdateConfig({ collection_id: id, collection_title: match?.title ?? "" });
              }}
              disabled={collectionsLoading}
            >
              <SelectTrigger className="w-full bg-muted text-xs">
                <SelectValue placeholder={collectionsLoading ? "Loading collections…" : "Choose a collection"}>
                  {collectionId ? cfg.collection_title || `Collection ${collectionId}` : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-72">
                {collectionId && !collections?.some((c) => String(c.id) === collectionId) ? (
                  <SelectItem value={collectionId}>{cfg.collection_title || collectionId}</SelectItem>
                ) : null}
                {(collections ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                    {c.kind === "smart" ? " · automated" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {collectionsError ? (
              <p className="mt-1 text-[11px] text-destructive">{collectionsError}</p>
            ) : collections && collections.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No collections found in your Shopify store.
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Products to show
            </label>
            <Select
              value={String(maxProducts)}
              onValueChange={(v) => {
                if (v) onUpdateConfig({ max_products: Number(v) });
              }}
            >
              <SelectTrigger className="w-full bg-muted text-xs">
                <SelectValue>
                  {maxProducts === 1 ? "1 product (single card)" : `${maxProducts} products (carousel)`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_SEND_PRODUCTS }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 1 ? "1 product (single card)" : `${n} products (carousel)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Picked from the collection each time the flow runs, in the
              collection&apos;s order. Out-of-stock items and items without an
              image are skipped, so new products show up automatically.
            </p>
            {collectionId ? (
              previewLoading ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking the collection…
                </p>
              ) : collectionPreview && collectionPreview.length < Math.min(maxProducts, 2) ? (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  Only {collectionPreview.length} in-stock product
                  {collectionPreview.length === 1 ? "" : "s"} with images in this
                  collection right now. Sync the catalog if that looks wrong.
                </p>
              ) : collectionPreview && collectionPreview.length < maxProducts ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {collectionPreview.length} products available right now.
                </p>
              ) : null
            ) : null}
          </div>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Variable holding the variant ID(s)
          </label>
          <Input
            value={cfg.variant_id_var ?? "shopify_variant_id"}
            onChange={(e) =>
              onUpdateConfig({
                variant_id_var: e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
              })
            }
            placeholder="shopify_variant_id"
            className="bg-muted font-mono text-xs"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Reads{" "}
            <code className="rounded bg-muted px-1 text-foreground">
              {`{{vars.${cfg.variant_id_var || "shopify_variant_id"}}}`}
            </code>{" "}
            at run time, e.g. saved by an HTTP fetch step. One variant ID sends a
            single card; a list (comma-separated or an array) sends a carousel.
          </p>
        </div>
      )}

      <div>
        <TextRow
          label={isCarousel ? "Message above the carousel" : "Message above the product (optional)"}
          value={cfg.message_text ?? ""}
          onChange={(v) => onUpdateConfig({ message_text: v })}
          rows={3}
        />
        {isCarousel && !cfg.message_text?.trim() ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            WhatsApp needs text above a carousel, so &ldquo;{DEFAULT_CAROUSEL_INTRO}&rdquo;
            is used when this is empty.
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Button opens</label>
        <Select
          value={linkTarget}
          onValueChange={(v) => {
            if (v) onUpdateConfig({ link_target: v });
          }}
        >
          <SelectTrigger className="w-full bg-muted text-xs">
            <SelectValue>
              {linkTarget === "checkout"
                ? "Checkout with the item in the cart"
                : "The product page on your store"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="checkout">Checkout with the item in the cart</SelectItem>
            <SelectItem value="product_page">The product page on your store</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {linkTarget === "checkout"
            ? "Skips the store page: the customer lands on checkout ready to pay."
            : "Opens the product page with the variant preselected, so customers can browse details, pick options and add to cart themselves."}
        </p>
      </div>

      <div className={cn("grid gap-2", linkTarget === "checkout" ? "grid-cols-2" : "grid-cols-1")}>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Button label</label>
          <Input
            value={buttonLabel}
            maxLength={PRODUCT_BUTTON_MAX}
            onChange={(e) => onUpdateConfig({ button_label: e.target.value })}
            placeholder={defaultLabel}
            className="bg-muted text-xs"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {buttonLabel.length}/{PRODUCT_BUTTON_MAX}
            {isCarousel ? " · same on every card" : ""}
          </p>
        </div>
        {linkTarget === "checkout" ? (
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Quantity in cart</label>
          <Input
            type="number"
            min={1}
            value={cfg.quantity ?? 1}
            onChange={(e) =>
              onUpdateConfig({
                quantity: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
              })
            }
            className="bg-muted text-xs"
          />
        </div>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Preview</label>
        {isCarousel ? (
          <div className="rounded-lg border border-border bg-muted/40 p-2">
            <p className="mb-2 whitespace-pre-wrap px-1 text-xs text-foreground">{introText}</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(previewItems.length > 0
                ? previewItems
                : Array.from({ length: Math.min(maxProducts, 3) }, (_, i) => ({
                    shopify_variant_id: `placeholder-${i}`,
                    title: "",
                  }) as PickedProduct)
              ).map((product) => (
                <div
                  key={product.shopify_variant_id}
                  className="w-36 shrink-0 overflow-hidden rounded-lg border border-border bg-background shadow-sm"
                >
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image_url} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted">
                      <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="space-y-0.5 px-2 py-1.5 text-[11px]">
                    <p className="line-clamp-2 font-medium text-foreground">
                      {product.title || "Product title"}
                    </p>
                    <p className="text-muted-foreground">
                      {product.price ? formatProductPrice(product.price, product.currency) : "Price"}
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-1 border-t border-border py-1.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                    <ExternalLink className="h-3 w-3" />
                    {ctaLabel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-64 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
            {previewItems[0]?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewItems[0].image_url} alt="" className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-[2/1] w-full items-center justify-center bg-muted">
                <ShoppingBag className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-1 px-3 py-2 text-xs">
              {introText ? (
                <p className="whitespace-pre-wrap text-foreground">{introText}</p>
              ) : null}
              <p className="font-medium text-foreground">
                {previewItems[0]
                  ? previewItems[0].title +
                    (productVariantLabel(previewItems[0].variant_title)
                      ? ` (${productVariantLabel(previewItems[0].variant_title)})`
                      : "")
                  : source === "variable"
                    ? "Product from variable"
                    : "Product title"}
              </p>
              <p className="text-muted-foreground">
                {previewItems[0]?.price
                  ? formatProductPrice(previewItems[0].price, previewItems[0].currency)
                  : "Price"}
              </p>
            </div>
            <div className="flex items-center justify-center gap-1 border-t border-border py-2 text-xs font-medium text-sky-600 dark:text-sky-400">
              <ExternalLink className="h-3 w-3" />
              {ctaLabel}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
