/**
 * Shared editor primitives used by both the linear-list and canvas
 * views of a flow.
 *
 * What lives here vs in flow-builder.tsx / flow-canvas.tsx:
 *   - Types and metadata that BOTH views need to render a node
 *     consistently (icon, label, color, 1-line summary).
 *   - Editing-only helpers (defaultConfigFor, slugify, uniqueNodeKey,
 *     BuilderState) stay in flow-builder.tsx until the canvas grows
 *     editing affordances — pulled across in the PR that adds them.
 *
 * Why .tsx and not .ts: NODE_META holds lucide icon components, which
 * are typed as React components; importing them from a .ts module
 * works at runtime but trips TypeScript's
 * `verbatimModuleSyntax`-related linting in some setups. Keeping the
 * file .tsx future-proofs it for inline JSX in node-card renderers.
 */

import {
  Flag,
  GitFork,
  Inbox,
  ListChecks,
  ListPlus,
  MapPin,
  MessageCircle,
  Paperclip,
  PlayCircle,
  Tag,
  UserCheck,
  UserPlus,
  Workflow,
  FileText,
  Hourglass,
  Webhook,
  PencilLine,
  Briefcase,
  CircleSlash,
  ClipboardList,
  ShoppingBag,
} from "lucide-react";
import { resolveContactFieldLabel } from "@/lib/contact-fields";
import {
  resolvePipelineLabel,
  resolveStageLabel,
  type PipelineOption,
  type StageOption,
} from "@/lib/pipelines";
import { SHOPIFY_PAYMENT_STATUS_LABELS } from "@/lib/flows/trigger-types";
import type { CustomField } from "@/types";
import { cn } from "@/lib/utils";

// ============================================================
// Node-type union — single source of truth for every place the UI
// enumerates types (add menu, type pickers, switch statements). Kept
// in lockstep with `FlowNodeType` in src/lib/flows/types.ts (which
// drives the engine's exhaustiveness check); a divergence between the
// two is always a bug.
// ============================================================

export type NodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "send_media"
  | "send_product"
  | "send_template"
  | "collect_input"
  | "send_address"
  | "send_flow"
  | "condition"
  | "switch"
  | "set_tag"
  | "handoff"
  | "wait"
  | "send_webhook"
  | "http_fetch"
  | "update_contact_field"
  | "assign_conversation"
  | "create_deal"
  | "close_conversation"
  | "end";

export interface BuilderNode {
  node_key: string;
  node_type: NodeType;
  config: Record<string, unknown>;
  /** Optional in v1 — defaults to 0 in the DB. Canvas view reads it
   *  to position nodes; list view ignores it. */
  position_x?: number;
  position_y?: number;
}

// ============================================================
// Per-node-type metadata used to render icons + labels everywhere
// the user sees a node summary.
// ============================================================

// ------------------------------------------------------------
// Node categories — buckets the add-step menu groups types under so
// the picker stays scannable as the type list grows, and so a fork
// adding its own node types has an obvious place to slot them.
//
// Note there's no "Events / Triggers" category: in wacrm a flow is
// triggered by flow-level config (`trigger_type`), not by a node on
// the canvas, so `start` is just the entry point under Flow control.
// ------------------------------------------------------------

export type NodeCategory = 'messaging' | 'logic' | 'flow';

/** Category labels + the order they render in the add-step menu. */
export const NODE_CATEGORIES: { id: NodeCategory; label: string }[] = [
  { id: 'messaging', label: 'Messaging' },
  { id: 'logic', label: 'Logic & data' },
  { id: 'flow', label: 'Flow control' },
];

export const NODE_META: Record<
  NodeType,
  {
    label: string;
    icon: typeof Workflow;
    color: string;
    blurb: string;
    category: NodeCategory;
  }
> = {
  start: {
    label: 'Start',
    icon: PlayCircle,
    color: 'text-emerald-400',
    blurb: 'Entry point of the flow',
    category: 'flow',
  },
  send_message: {
    label: 'Send message',
    icon: MessageCircle,
    color: 'text-sky-400',
    blurb: 'Sends a WhatsApp text message',
    category: 'messaging',
  },
  send_buttons: {
    label: 'Send buttons',
    icon: ListChecks,
    color: 'text-primary',
    blurb: 'Sends quick-reply buttons',
    category: 'messaging',
  },
  send_list: {
    label: 'Send list',
    icon: ListPlus,
    color: 'text-indigo-400',
    blurb: 'Sends a tappable list of options',
    category: 'messaging',
  },
  send_media: {
    label: 'Send media',
    icon: Paperclip,
    color: 'text-cyan-400',
    blurb: 'Sends an image, video, or document',
    category: 'messaging',
  },
  send_product: {
    label: "Send product",
    icon: ShoppingBag,
    color: "text-emerald-400",
    blurb: "Sends a Shopify product card",
    category: "messaging",
  },
  collect_input: {
    label: 'Collect input',
    icon: Inbox,
    color: 'text-teal-400',
    blurb: 'Asks a question, saves the reply',
    category: 'logic',
  },
  send_address: {
    label: "Collect address",
    icon: MapPin,
    color: "text-rose-400",
    blurb: "Collects a delivery address",
    category: "messaging",
  },
  send_flow: {
    label: "Send WhatsApp form",
    icon: ClipboardList,
    color: "text-violet-400",
    blurb: "Opens a WhatsApp Flow form",
    category: "messaging",
  },
  condition: {
    label: "Condition",
    icon: GitFork,
    color: 'text-fuchsia-400',
    blurb: 'Branches on a rule',
    category: 'logic',
  },
  switch: {
    label: "Condition branches",
    icon: GitFork,
    color: "text-violet-400",
    blurb: "Multi-way branch on rules",
    category: "logic",
  },
  set_tag: {
    label: 'Tag contact',
    icon: Tag,
    color: 'text-pink-400',
    blurb: 'Adds or removes a contact tag',
    category: 'logic',
  },
  handoff: {
    label: 'Handoff to agent',
    icon: UserPlus,
    color: 'text-amber-400',
    blurb: 'Hands the conversation to a human',
    category: 'flow',
  },
  send_template: {
    label: "Send template",
    icon: FileText,
    color: "text-violet-400",
    blurb: "Sends an approved WhatsApp template",
    category: "messaging",
  },
  wait: {
    label: "Wait",
    icon: Hourglass,
    color: "text-slate-400",
    blurb: "Pauses before the next step",
    category: "flow",
  },
  send_webhook: {
    label: "Send webhook",
    icon: Webhook,
    color: "text-orange-400",
    blurb: "POSTs data to an external URL",
    category: "logic",
  },
  http_fetch: {
    label: "HTTP request",
    icon: Webhook,
    color: "text-orange-300",
    blurb: "Fetches data from an external URL",
    category: "logic",
  },
  update_contact_field: {
    label: "Update contact field",
    icon: PencilLine,
    color: "text-lime-400",
    blurb: "Writes contact fields",
    category: "logic",
  },
  assign_conversation: {
    label: "Assign conversation",
    icon: UserCheck,
    color: "text-cyan-400",
    blurb: "Assigns the chat to an agent",
    category: "flow",
  },
  create_deal: {
    label: "Create deal",
    icon: Briefcase,
    color: "text-yellow-400",
    blurb: "Creates a pipeline deal",
    category: "logic",
  },
  close_conversation: {
    label: "Close conversation",
    icon: CircleSlash,
    color: "text-red-400",
    blurb: "Closes the inbox conversation",
    category: "flow",
  },
  end: {
    label: 'End',
    icon: Flag,
    color: 'text-muted-foreground',
    blurb: 'Ends the flow',
    category: 'flow',
  },
};

/**
 * Bucket an ordered list of node types by category, preserving both
 * the category order (NODE_CATEGORIES) and the within-category order
 * of the input list. Empty categories are dropped. Used by both the
 * canvas and list add-step menus so they stay in lockstep.
 */
export function groupNodeTypesByCategory(
  types: NodeType[]
): { id: NodeCategory; label: string; types: NodeType[] }[] {
  return NODE_CATEGORIES.map(({ id, label }) => ({
    id,
    label,
    types: types.filter((t) => NODE_META[t].category === id),
  })).filter((group) => group.types.length > 0);
}

// ============================================================
// Per-node-type color system.
//
// Each node type gets its own hue so the canvas reads at a glance —
// what KIND of step is this. Kept as raw oklch (not Tailwind classes)
// so a node card can tint its icon chip, type label, selection ring,
// and edge ports from one source, the way the Flow Builder design
// handoff does. Hues sit in the same oklch family as the app tokens
// in globals.css; they don't replace --primary (the accent), they
// complement it. `nodeColors()` derives the soft/ring/text variants.
// ============================================================

const NODE_HUE: Record<NodeType, { l: number; c: number; h: number }> = {
  start: { l: 0.62, c: 0.13, h: 162 },
  send_message: { l: 0.6, c: 0.18, h: 293 },
  send_buttons: { l: 0.62, c: 0.16, h: 254 },
  send_list: { l: 0.62, c: 0.15, h: 277 },
  send_media: { l: 0.65, c: 0.12, h: 210 },
  send_product: { l: 0.62, c: 0.13, h: 162 },
  send_template: { l: 0.62, c: 0.16, h: 280 },
  collect_input: { l: 0.65, c: 0.1, h: 185 },
  send_address: { l: 0.65, c: 0.14, h: 16 },
  send_flow: { l: 0.62, c: 0.16, h: 280 },
  condition: { l: 0.72, c: 0.15, h: 65 },
  switch: { l: 0.68, c: 0.14, h: 290 },
  set_tag: { l: 0.65, c: 0.15, h: 350 },
  handoff: { l: 0.65, c: 0.17, h: 16 },
  wait: { l: 0.58, c: 0.02, h: 260 },
  send_webhook: { l: 0.68, c: 0.16, h: 45 },
  http_fetch: { l: 0.66, c: 0.14, h: 55 },
  update_contact_field: { l: 0.7, c: 0.14, h: 130 },
  assign_conversation: { l: 0.65, c: 0.12, h: 210 },
  create_deal: { l: 0.72, c: 0.15, h: 85 },
  close_conversation: { l: 0.6, c: 0.16, h: 25 },
  end: { l: 0.55, c: 0.01, h: 260 },
};

export interface NodeColors {
  /** Full-strength hue — icon glyph, selection ring, port fill. */
  solid: string;
  /** ~14% tint — icon chip background, soft fills. */
  soft: string;
  /** ~45% tint — hover border / focus ring. */
  ring: string;
  /** Hue for the uppercase type label, kept readable in BOTH modes. */
  text: string;
}

const FALLBACK_NODE_TYPE: NodeType = "send_message";

/** Coerce DB / legacy node types to a known editor type so render never crashes. */
export function resolveNodeType(type: string): NodeType {
  if (Object.prototype.hasOwnProperty.call(NODE_META, type)) {
    return type as NodeType;
  }
  return FALLBACK_NODE_TYPE;
}

export function nodeMetaFor(type: string) {
  return NODE_META[resolveNodeType(type)];
}

export function nodeColors(type: NodeType): NodeColors {
  const t = NODE_HUE[type];
  const solid = `oklch(${t.l} ${t.c} ${t.h})`;
  return {
    solid,
    soft: `oklch(${t.l} ${t.c} ${t.h} / 0.14)`,
    ring: `oklch(${t.l} ${t.c} ${t.h} / 0.45)`,
    // Blend the hue toward the live --foreground token so the label
    // holds contrast in BOTH modes: in dark mode --foreground is
    // near-white (the label lightens to read on the dark card), in
    // light mode it's near-black (the label darkens to read on the
    // white card). The old fixed-light value only worked on dark.
    text: `color-mix(in oklch, ${solid}, var(--foreground) 38%)`,
  };
}

export function nodeColorsFor(type: string): NodeColors {
  return nodeColors(resolveNodeType(type));
}

// ============================================================
// Shared node icon chip — the per-type colored glyph badge used in
// the canvas node card, list-view card, inspector header, and the
// add-step menu. One component so a styling change (radius, contrast,
// hover) lands in every place at once and the `nodeColors()` lookup
// lives in exactly one spot.
// ============================================================

export function NodeIconChip({
  type,
  size = 24,
  iconSize = 14,
  className,
}: {
  type: NodeType | string;
  /** Chip side length in px. */
  size?: number;
  /** Glyph side length in px. */
  iconSize?: number;
  className?: string;
}) {
  const resolved = resolveNodeType(type);
  const meta = NODE_META[resolved];
  const c = nodeColors(resolved);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        className
      )}
      style={{ width: size, height: size, background: c.soft, color: c.solid }}
    >
      <Icon size={iconSize} />
    </span>
  );
}

// ============================================================
// Pure editing helpers — used by forms in both views.
// ============================================================

/**
 * Coerce an arbitrary string into a stable identifier (node_key,
 * reply_id, etc.). Lowercases, collapses non-alphanumerics into
 * single underscores, and trims leading/trailing underscores. Falls
 * back to `fallback` for inputs that reduce to an empty string.
 */
export function slugify(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

// ============================================================
// Summary helpers — short, single-line content previews used in
// collapsed node cards (list view) and node tiles (canvas view).
// Returns null when there's nothing meaningful to show (start/end,
// or a freshly-added node with no fields filled in).
// ============================================================

export function truncate(s: string, max = 80): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

export interface SummarizeNodeOptions {
  customFields?: CustomField[];
  pipelines?: PipelineOption[];
  stages?: StageOption[];
  t?: (key: string, values?: Record<string, string | number>) => string;
}

export function summarizeNode(
  node: BuilderNode,
  optionsOrT?:
    | SummarizeNodeOptions
    | ((key: string, values?: Record<string, string | number>) => string),
): string | null {
  const options =
    typeof optionsOrT === "function" ? { t: optionsOrT } : optionsOrT;
  const customFields = options?.customFields ?? [];
  const pipelines = options?.pipelines ?? [];
  const stages = options?.stages ?? [];
  const t = options?.t;
  const cfg = node.config;
  switch (node.node_type) {
    case 'start':
    case 'end':
      return null;
    case 'send_message': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      return text.length > 0 ? truncate(text) : null;
    }
    case 'send_buttons': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      const buttons = Array.isArray(cfg.buttons)
        ? (cfg.buttons as Array<Record<string, unknown>>)
        : [];
      const titles = buttons
        .map((b) => (typeof b.title === 'string' ? b.title : ''))
        .filter(Boolean)
        .join(' / ');
      if (text.length > 0) {
        return titles
          ? `${truncate(text, 40)} · ${truncate(titles, 35)}`
          : truncate(text);
      }
      return titles || null;
    }
    case 'send_list': {
      const text = typeof cfg.text === 'string' ? cfg.text : '';
      const sections = Array.isArray(cfg.sections)
        ? (cfg.sections as Array<Record<string, unknown>>)
        : [];
      const rowCount = sections.reduce<number>((sum, s) => {
        const rows = Array.isArray(s.rows) ? s.rows : [];
        return sum + rows.length;
      }, 0);
      if (text.length > 0) {
        return rowCount > 0
          ? `${truncate(text, 50)} · ${t ? t('options', { count: rowCount }) : `${rowCount} option${rowCount === 1 ? '' : 's'}`}`
          : truncate(text);
      }
      return rowCount > 0
        ? t
          ? t('optionsAcrossSections', { rowCount, sectionCount: sections.length })
          : `${rowCount} option${rowCount === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`
        : null;
    }
    case "send_product": {
      const source =
        cfg.product_source === "variable" ? "variable" : "fixed";
      const title =
        typeof cfg.product_title === "string" ? cfg.product_title : "";
      const variantId =
        cfg.shopify_variant_id != null ? String(cfg.shopify_variant_id) : "";
      const varKey =
        typeof cfg.variant_id_var === "string" ? cfg.variant_id_var : "";
      if (source === "variable") {
        return varKey
          ? `Product from vars.${varKey}`
          : "Product from vars.shopify_variant_id";
      }
      return title
        ? truncate(title, 60)
        : variantId
          ? `Variant ${truncate(variantId, 24)}`
          : "No product selected";
    }
    case 'send_media': {
      const mediaType =
        typeof cfg.media_type === 'string' ? cfg.media_type : '';
      const filename = typeof cfg.filename === 'string' ? cfg.filename : '';
      const url = typeof cfg.media_url === 'string' ? cfg.media_url : '';
      const caption = typeof cfg.caption === 'string' ? cfg.caption : '';
      const label = mediaType
        ? t ? t(mediaType) || (mediaType.charAt(0).toUpperCase() + mediaType.slice(1)) : mediaType.charAt(0).toUpperCase() + mediaType.slice(1)
        : t ? t('media') : 'Media';
      if (!url) return t ? t('noFile', { label }) : `${label} (no file uploaded)`;
      const name = filename || url.split('/').pop() || 'file';
      return caption
        ? `${label}: ${truncate(name, 30)} · ${truncate(caption, 40)}`
        : `${label}: ${truncate(name, 60)}`;
    }
    case 'collect_input': {
      const prompt = typeof cfg.prompt_text === 'string' ? cfg.prompt_text : '';
      const varKey = typeof cfg.var_key === 'string' ? cfg.var_key : '';
      if (prompt.length > 0) {
        return varKey
          ? `${truncate(prompt, 50)} → vars.${varKey}`
          : truncate(prompt);
      }
      return varKey ? `→ vars.${varKey}` : null;
    }
    case "send_address": {
      const body = typeof cfg.body_text === "string" ? cfg.body_text : "";
      const country = typeof cfg.country === "string" ? cfg.country : "";
      const varKey = typeof cfg.var_key === "string" ? cfg.var_key : "";
      const bits = [
        country ? country : null,
        body ? truncate(body, 40) : null,
        varKey ? `→ vars.${varKey}` : null,
      ].filter(Boolean);
      return bits.length > 0 ? bits.join(" · ") : null;
    }
    case "send_flow": {
      const body = typeof cfg.body_text === "string" ? cfg.body_text : "";
      const flowId = typeof cfg.flow_id === "string" ? cfg.flow_id : "";
      const varKey = typeof cfg.var_key === "string" ? cfg.var_key : "";
      const bits = [
        flowId ? `Flow ${truncate(flowId, 16)}` : null,
        body ? truncate(body, 40) : null,
        varKey ? `→ vars.${varKey}` : null,
      ].filter(Boolean);
      return bits.length > 0 ? bits.join(" · ") : null;
    }
    case 'condition': {
      if (cfg.subject === "shopify_payment") {
        const value = typeof cfg.value === "string" ? cfg.value : "";
        const label =
          value in SHOPIFY_PAYMENT_STATUS_LABELS
            ? SHOPIFY_PAYMENT_STATUS_LABELS[value as keyof typeof SHOPIFY_PAYMENT_STATUS_LABELS]
            : value || "paid";
        return `payment is ${label}`;
      }
      const subjectKey =
        typeof cfg.subject_key === 'string' ? cfg.subject_key : '';
      if (!subjectKey) return null;
      const subject =
        cfg.subject === 'tag'
          ? 'tag'
          : cfg.subject === 'contact_field'
            ? 'field'
            : 'var';
      const subjectStr =
        subject === 'tag'
          ? t ? t('hasTag', { tag: truncate(subjectKey, 24) }) : `has tag ${truncate(subjectKey, 24)}`
          : `${subject}.${subjectKey}`;
      const op =
        cfg.operator === "equals"
          ? "=="
          : cfg.operator === "not_equals"
            ? "!="
            : cfg.operator === "contains"
              ? t ? t('opContains') : 'contains'
              : cfg.operator === "present"
                ? t ? t('opExists') : 'exists'
                : cfg.operator === "absent"
                  ? t ? t('opMissing') : 'missing'
                  : "";
      const value = typeof cfg.value === "string" ? cfg.value : "";
      const valStr =
        (cfg.operator === "equals" ||
          cfg.operator === "not_equals" ||
          cfg.operator === "contains") &&
        value
          ? ` "${truncate(value, 20)}"`
          : '';
      return subject === 'tag' ? subjectStr : `${subjectStr} ${op}${valStr}`;
    }
    case "switch": {
      const branches = Array.isArray(cfg.branches)
        ? (cfg.branches as Array<{ label?: string }>)
        : [];
      const count = branches.length;
      return count > 0
        ? `${count} branch${count === 1 ? "" : "es"} + else`
        : "No branches configured";
    }
    case 'set_tag': {
      const mode = cfg.mode === 'remove' ? (t ? t('modeRemove') : 'Remove') : (t ? t('modeAdd') : 'Add');
      const tagId = typeof cfg.tag_id === 'string' ? cfg.tag_id : '';
      // No tag name available without an async lookup here; show a
      // short prefix of the UUID so users can disambiguate between
      // multiple set_tag nodes at a glance.
      return tagId
        ? t ? t('tagPicked', { mode, tag: tagId.slice(0, 8) }) : `${mode} tag ${tagId.slice(0, 8)}…`
        : t ? t('tagNone', { mode }) : `${mode} tag (none picked)`;
    }
    case 'handoff': {
      const note = typeof cfg.note === 'string' ? cfg.note : '';
      return note.length > 0 ? truncate(note) : null;
    }
    case "send_template": {
      const name = typeof cfg.template_name === "string" ? cfg.template_name : "";
      const qr = Array.isArray(cfg.buttons) ? cfg.buttons.length : 0;
      if (!name) return null;
      return qr > 0
        ? `Template: ${truncate(name, 40)} · ${qr} button${qr === 1 ? "" : "s"}`
        : `Template: ${truncate(name, 50)}`;
    }
    case "wait": {
      const amount = cfg.amount ?? 1;
      const unit = typeof cfg.unit === "string" ? cfg.unit : "hours";
      return `Wait ${amount} ${unit}`;
    }
    case "send_webhook":
    case "http_fetch": {
      const url = typeof cfg.url === "string" ? cfg.url : "";
      return url ? truncate(url, 60) : null;
    }
    case "update_contact_field": {
      const fields = Array.isArray(cfg.fields) ? cfg.fields : null;
      if (fields?.length) {
        const labels = fields
          .map((entry) => {
            const row = entry as { field?: string };
            return typeof row.field === "string"
              ? resolveContactFieldLabel(row.field, customFields)
              : "";
          })
          .filter(Boolean);
        if (labels.length === 1) return `Set ${labels[0]}`;
        if (labels.length > 1) return `Set ${labels.length} fields`;
      }
      const field = typeof cfg.field === "string" ? cfg.field : "";
      return field
        ? `Set ${resolveContactFieldLabel(field, customFields)}`
        : null;
    }
    case "assign_conversation":
      return "Assign conversation";
    case "create_deal": {
      const title = typeof cfg.title === "string" ? cfg.title.trim() : "";
      const pipelineId =
        typeof cfg.pipeline_id === "string" ? cfg.pipeline_id : "";
      const stageId = typeof cfg.stage_id === "string" ? cfg.stage_id : "";
      if (title) return truncate(title, 50);
      if (stageId) {
        const stageName = resolveStageLabel(stageId, stages);
        if (stageName && stageName !== "Unknown stage") {
          return `Stage: ${stageName}`;
        }
      }
      if (pipelineId) {
        const pipelineName = resolvePipelineLabel(pipelineId, pipelines);
        if (pipelineName && pipelineName !== "Unknown pipeline") {
          return `Pipeline: ${pipelineName}`;
        }
      }
      return "Pick pipeline & stage";
    }
    case "close_conversation":
      return "Close conversation";
    default:
      return null;
  }
}
