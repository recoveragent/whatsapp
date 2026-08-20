/**
 * Save-time validation for flows.
 *
 * Run before activation (not on every draft save) — drafts are
 * intentionally allowed to be incomplete so users can save progress
 * mid-build. The builder calls these from BOTH client (so the user
 * sees issues live) and server (so a broken POST/PUT can't slip in
 * via direct API call).
 *
 * Three rule categories:
 *   1. Trigger sanity — keyword flows need keywords, etc.
 *   2. Graph integrity — entry node exists, all next_node_key
 *      references resolve, no unreachable nodes, non-terminal nodes
 *      have an outgoing edge.
 *   3. Meta API limits — button title ≤20 chars, ≤3 buttons per
 *      send_buttons, ≤10 list rows total, ≤24 chars per list row
 *      title. Mirrors the runtime checks inside
 *      `src/lib/whatsapp/meta-api.ts` so save-time and send-time
 *      can never disagree.
 *
 * Issues carry enough field info that the builder can highlight the
 * exact input that triggered them. Node-scoped issues include
 * `node_key`; trigger-scoped use `scope: 'trigger'`.
 */

import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";
import {
  parseExitConfig,
  type FlowExitConfig,
} from "./exit-conditions";
import {
  parseReplyTimeout,
  nodeTypeHasReplyTimeoutSlot,
  isReplyTimeoutEnabled,
  hasReplyTimeoutTiming,
} from "./reply-timeout";

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  /** Stable node_key the issue is attached to, when scope === 'node'. */
  node_key?: string;
  /** Dotted path to the bad field, e.g. 'buttons.0.title'. */
  field?: string;
  message: string;
}

interface FlowInput {
  name: string;
  trigger_type: import("@/lib/flows/trigger-types").FlowTriggerType;
  trigger_config: Record<string, unknown>;
  exit_config?: FlowExitConfig | Record<string, unknown> | null;
  entry_node_id: string | null;
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

function collectReplyTimeoutIssues(
  node: NodeInput,
  knownKeys: Set<string>,
  issues: ValidationIssue[],
): void {
  const cfg = node.config;
  const next =
    typeof cfg.reply_timeout_next_node_key === "string"
      ? cfg.reply_timeout_next_node_key.trim()
      : "";
  const hasNext = next.length > 0;

  if (!isReplyTimeoutEnabled(cfg)) {
    return;
  }

  if (!hasReplyTimeoutTiming(cfg)) {
    if (hasNext) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        field: "reply_timeout_amount",
        message:
          "Timeout branch needs a duration, or disconnect the Timeout handle on the canvas.",
      });
    }
    return;
  }

  if (!hasNext) {
    issues.push({
      severity: "error",
      scope: "node",
      node_key: node.node_key,
      field: "reply_timeout_next_node_key",
      message: "Connect the Timeout handle on the canvas to a target node.",
    });
    return;
  }

  const parsed = parseReplyTimeout(cfg);
  if (!parsed) return;

  if (!knownKeys.has(parsed.next_node_key)) {
    issues.push({
      severity: "error",
      scope: "node",
      node_key: node.node_key,
      field: "reply_timeout_next_node_key",
      message: `Timeout branch points to non-existent node "${parsed.next_node_key}".`,
    });
  }
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ---- name ----
  if (!flow.name || !flow.name.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "Flow name is required.",
    });
  }

  // ---- trigger ----
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));
  issues.push(...validateExitConfig(parseExitConfig(flow.exit_config)));

  // ---- graph integrity ----
  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Pick an entry node before activating.",
    });
  }

  const keys = new Set(nodes.map((n) => n.node_key));
  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "A flow needs at least one node before activation.",
    });
  }

  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `Entry node "${flow.entry_node_id}" doesn't exist.`,
    });
  }

  // Duplicate node_key (the DB UNIQUE constraint catches this on save
  // too, but surfacing it client-side gives a friendlier error path).
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: n.node_key,
        message: `Duplicate node_key "${n.node_key}".`,
      });
    }
    seen.add(n.node_key);
  }

  // Per-node rules (Meta limits + dead-end + edge resolution).
  for (const n of nodes) {
    issues.push(...validateNode(n, keys));
  }

  // Reachability — every non-orphan node must be reachable from the
  // entry. Done after per-node validation so we don't double-report
  // when a node has bad config AND is unreachable.
  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const n of nodes) {
      if (!reached.has(n.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: n.node_key,
          message: `Node "${n.node_key}" is unreachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

// ============================================================
// Trigger
// ============================================================

function validateTrigger(
  trigger_type: FlowInput["trigger_type"],
  trigger_config: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (trigger_type === "keyword") {
    const keywords = Array.isArray(trigger_config.keywords)
      ? (trigger_config.keywords as unknown[])
      : null;
    if (!keywords || keywords.length === 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.keywords",
        message: "Keyword triggers need at least one keyword.",
      });
    } else {
      // Empty / whitespace-only keywords are silent no-ops at match
      // time — call them out so the user doesn't think they configured
      // a keyword that never fires.
      const blanks = keywords.filter(
        (k) => typeof k !== "string" || !k.trim(),
      ).length;
      if (blanks > 0) {
        issues.push({
          severity: "warning",
          scope: "trigger",
          field: "trigger_config.keywords",
          message: `${blanks} keyword${blanks === 1 ? " is" : "s are"} blank — they won't match anything.`,
        });
      }
    }
  }
  if (trigger_type === "tag_added") {
    if (!nonEmpty(trigger_config.tag_id)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.tag_id",
        message: "Tag triggers need a tag id.",
      });
    }
  }
  if (trigger_type === "webhook_received") {
    if (!nonEmpty(trigger_config.webhook_token)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.webhook_token",
        message: "Webhook triggers need a token — save the flow first.",
      });
    }
    if (!nonEmpty(trigger_config.phone_path)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.phone_path",
        message: "Webhook triggers need a phone path.",
      });
    }
  }
  if (trigger_type === "time_based") {
    if (!nonEmpty(trigger_config.schedule)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.schedule",
        message: "Time-based triggers need a schedule.",
      });
    }
    if (!nonEmpty(trigger_config.tag_id)) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.tag_id",
        message: "Time-based triggers need a tag id (audience).",
      });
    }
  }
  if (
    trigger_type === "shopify_order_placed" ||
    trigger_type === "shopify_order_updated" ||
    trigger_type === "shopify_order_fulfilled" ||
    trigger_type === "shopify_order_cancelled" ||
    trigger_type === "shopify_order_partially_fulfilled"
  ) {
    const ps = trigger_config.payment_status as string | undefined;
    if (
      ps &&
      ps !== "any" &&
      !["paid", "pending", "partially_paid"].includes(ps)
    ) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.payment_status",
        message: "Payment status must be any, paid, pending, or partially paid.",
      });
    }
  }
  if (trigger_type === "google_sheet_row") {
    const sources = Array.isArray(trigger_config.sources)
      ? (trigger_config.sources as unknown[])
      : null;
    // Legacy flat config still validates as one source
    if (!sources) {
      if (!nonEmpty(trigger_config.spreadsheet_id)) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: "trigger_config.spreadsheet_id",
          message: "Paste a Google Sheet URL and load it.",
        });
      }
      if (!nonEmpty(trigger_config.sheet_name)) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: "trigger_config.sheet_name",
          message: "Pick a sheet tab.",
        });
      }
      if (!nonEmpty(trigger_config.phone_column)) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: "trigger_config.phone_column",
          message: "Map a phone column (required).",
        });
      }
    } else if (sources.length === 0) {
      issues.push({
        severity: "error",
        scope: "trigger",
        field: "trigger_config.sources",
        message: "Add at least one Google Sheet source.",
      });
    } else {
      sources.forEach((raw, i) => {
        const s =
          raw && typeof raw === "object"
            ? (raw as Record<string, unknown>)
            : {};
        const prefix = `trigger_config.sources[${i}]`;
        if (!nonEmpty(s.spreadsheet_id)) {
          issues.push({
            severity: "error",
            scope: "trigger",
            field: `${prefix}.spreadsheet_id`,
            message: `Source ${i + 1}: paste a Google Sheet URL and load it.`,
          });
        }
        if (!nonEmpty(s.sheet_name)) {
          issues.push({
            severity: "error",
            scope: "trigger",
            field: `${prefix}.sheet_name`,
            message: `Source ${i + 1}: pick a sheet tab.`,
          });
        }
        if (!nonEmpty(s.phone_column)) {
          issues.push({
            severity: "error",
            scope: "trigger",
            field: `${prefix}.phone_column`,
            message: `Source ${i + 1}: map a phone column (required).`,
          });
        }
      });
    }
  }
  // first_inbound_message / manual / message triggers — no extra config.

  return issues;
}

// ============================================================
// Exit conditions
// ============================================================

function validateExitConfig(config: FlowExitConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  config.conditions.forEach((c, i) => {
    const prefix = `exit_config.conditions.${i}`;
    if (c.type === "tag_added" || c.type === "tag_removed") {
      if (!nonEmpty(c.tag_id)) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: `${prefix}.tag_id`,
          message: `End condition ${i + 1}: pick a tag.`,
        });
      }
    }
    if (c.type === "deal_stage") {
      if (!nonEmpty(c.stage_id)) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: `${prefix}.stage_id`,
          message: `End condition ${i + 1}: pick a lead stage.`,
        });
      }
    }
    if (c.type === "keyword") {
      const keywords = (c.keywords ?? []).map((k) => k.trim()).filter(Boolean);
      if (keywords.length === 0) {
        issues.push({
          severity: "error",
          scope: "trigger",
          field: `${prefix}.keywords`,
          message: `End condition ${i + 1}: add at least one keyword.`,
        });
      }
    }
  });
  return issues;
}

// ============================================================
// Per-node
// ============================================================

function validateNode(
  node: NodeInput,
  knownKeys: Set<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  switch (node.node_type) {
    case "start": {
      const cfg = node.config as { next_node_key?: string };
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Start node must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Start points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_message": {
      const cfg = node.config as { text?: string; next_node_key?: string };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Send-message node needs a text body.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Send-message node must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Send-message points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_media": {
      const cfg = node.config as {
        media_type?: "image" | "video" | "document";
        media_url?: string;
        caption?: string;
        next_node_key?: string;
      };
      if (
        !cfg.media_type ||
        !["image", "video", "document"].includes(cfg.media_type)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_type",
          message: "Send-media node needs a media type (image, video, or document).",
        });
      }
      if (!cfg.media_url?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "media_url",
          message: "Send-media node needs a file (upload one before activating).",
        });
      }
      // Caption cap mirrors Meta's interactive body cap; documented as a
      // hard limit in the WhatsApp Cloud API media-message reference.
      if (cfg.caption && cfg.caption.length > INTERACTIVE_LIMITS.bodyMaxLength) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "caption",
          message: `Caption exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars (WhatsApp limit).`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Send-media node must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Send-media points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_buttons": {
      const cfg = node.config as {
        text?: string;
        buttons?: Array<{
          reply_id?: string;
          title?: string;
          next_node_key?: string;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Send-buttons node needs a text body.",
        });
      }
      const btns = cfg.buttons ?? [];
      if (btns.length < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: "Send-buttons needs at least one button.",
        });
      }
      if (btns.length > INTERACTIVE_LIMITS.maxButtons) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "buttons",
          message: `WhatsApp allows at most ${INTERACTIVE_LIMITS.maxButtons} buttons per message.`,
        });
      }
      const seenIds = new Set<string>();
      btns.forEach((b, i) => {
        const field = `buttons.${i}`;
        if (!b.reply_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Button ${i + 1} needs a reply id.`,
          });
        } else if (seenIds.has(b.reply_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.reply_id`,
            message: `Duplicate button reply id "${b.reply_id}".`,
          });
        }
        if (b.reply_id) seenIds.add(b.reply_id);

        if (!b.title?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} needs a title.`,
          });
        } else if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.title`,
            message: `Button ${i + 1} title is over ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars (WhatsApp limit).`,
          });
        }

        if (!b.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} needs a next node.`,
          });
        } else if (!knownKeys.has(b.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${field}.next_node_key`,
            message: `Button ${i + 1} points to non-existent node "${b.next_node_key}".`,
          });
        }
      });
      break;
    }

    case "send_list": {
      const cfg = node.config as {
        text?: string;
        button_label?: string;
        sections?: Array<{
          title?: string;
          rows?: Array<{
            reply_id?: string;
            title?: string;
            description?: string;
            next_node_key?: string;
          }>;
        }>;
      };
      if (!cfg.text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "text",
          message: "Send-list node needs a text body.",
        });
      }
      if (!cfg.button_label?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "button_label",
          message: "Send-list needs a button label (the tap-to-expand text).",
        });
      }
      const sections = cfg.sections ?? [];
      const totalRows = sections.reduce(
        (sum, s) => sum + (s.rows?.length ?? 0),
        0,
      );
      if (totalRows < 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: "Send-list needs at least one row.",
        });
      }
      if (totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "sections",
          message: `Send-list allows at most ${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across sections.`,
        });
      }
      const seenIds = new Set<string>();
      sections.forEach((section, si) => {
        const rows = section.rows ?? [];
        rows.forEach((row, ri) => {
          const field = `sections.${si}.rows.${ri}`;
          if (!row.reply_id?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Row ${ri + 1} in section ${si + 1} needs a reply id.`,
            });
          } else if (seenIds.has(row.reply_id)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.reply_id`,
              message: `Duplicate list row id "${row.reply_id}".`,
            });
          }
          if (row.reply_id) seenIds.add(row.reply_id);

          if (!row.title?.trim()) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} needs a title.`,
            });
          } else if (
            row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.title`,
              message: `Row ${ri + 1} title exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`,
            });
          }
          if (
            row.description &&
            row.description.length >
              INTERACTIVE_LIMITS.listRowDescriptionMaxLength
          ) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.description`,
              message: `Row ${ri + 1} description exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`,
            });
          }
          if (!row.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} needs a next node.`,
            });
          } else if (!knownKeys.has(row.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `${field}.next_node_key`,
              message: `Row ${ri + 1} points to non-existent node "${row.next_node_key}".`,
            });
          }
        });
      });
      break;
    }

    case "collect_input": {
      const cfg = node.config as {
        prompt_text?: string;
        var_key?: string;
        next_node_key?: string;
      };
      if (!cfg.prompt_text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "prompt_text",
          message: "Collect-input needs a prompt to send the customer.",
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: "Collect-input needs a var_key to store the answer under.",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `var_key "${cfg.var_key}" must be alphanumeric+underscore and start with a letter or underscore.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Collect-input must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Collect-input points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_address": {
      const cfg = node.config as {
        body_text?: string;
        country?: string;
        var_key?: string;
        next_node_key?: string;
        header_text?: string;
        footer_text?: string;
      };
      if (!cfg.body_text?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "body_text",
          message: "Address message needs body text for the customer.",
        });
      }
      if (cfg.country !== "IN" && cfg.country !== "SG") {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "country",
          message: 'Address message country must be "IN" or "SG".',
        });
      }
      if (!cfg.var_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: "Address message needs a var_key to store the address under.",
        });
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cfg.var_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "var_key",
          message: `var_key "${cfg.var_key}" must be alphanumeric+underscore and start with a letter or underscore.`,
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Address message must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Address message points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "condition": {
      const cfg = node.config as {
        subject?: "var" | "tag" | "contact_field" | "shopify_payment";
        subject_key?: string;
        operator?: "equals" | "not_equals" | "contains" | "present" | "absent";
        value?: string;
        true_next?: string;
        false_next?: string;
      };
      if (
        !cfg.subject ||
        !["var", "tag", "contact_field", "shopify_payment"].includes(cfg.subject)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject",
          message: "Condition needs a subject (var / tag / contact_field / shopify_payment).",
        });
      }
      if (cfg.subject !== "shopify_payment" && !cfg.subject_key?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "subject_key",
          message: "Condition needs a subject_key (var name, tag id, or field name).",
        });
      }
      if (
        !cfg.operator ||
        !["equals", "not_equals", "contains", "present", "absent"].includes(cfg.operator)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "operator",
          message: "Condition needs an operator.",
        });
      } else if (
        cfg.subject === "shopify_payment" &&
        (cfg.value === undefined || cfg.value === "")
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message:
            "Shopify payment condition needs a payment status (paid, pending, or partially paid).",
        });
      } else if (
        (cfg.operator === "equals" ||
          cfg.operator === "not_equals" ||
          cfg.operator === "contains") &&
        (cfg.value === undefined || cfg.value === "")
      ) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          field: "value",
          message: `Operator "${cfg.operator}" usually expects a comparison value — empty value will only match empty subjects.`,
        });
      }
      for (const branch of ["true_next", "false_next"] as const) {
        const key = cfg[branch];
        if (!key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `Condition needs a node for the "${branch === "true_next" ? "true" : "false"}" branch.`,
          });
        } else if (!knownKeys.has(key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: branch,
            message: `Condition's "${branch}" points to non-existent node "${key}".`,
          });
        }
      }
      break;
    }

    case "switch": {
      const cfg = node.config as {
        branches?: Array<{
          branch_id?: string;
          label?: string;
          subject?: "var" | "tag" | "contact_field" | "shopify_payment";
          subject_key?: string;
          operator?: "equals" | "not_equals" | "contains" | "present" | "absent";
          value?: string;
          next_node_key?: string;
        }>;
        default_next?: string;
      };
      const branches = cfg.branches ?? [];
      if (branches.length === 0) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "branches",
          message: "Switch needs at least one condition branch.",
        });
      }
      branches.forEach((branch, index) => {
        const prefix = `branches[${index}]`;
        if (!branch.branch_id?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.branch_id`,
            message: "Each switch branch needs an internal id.",
          });
        }
        if (
          !branch.subject ||
          !["var", "tag", "contact_field", "shopify_payment"].includes(
            branch.subject,
          )
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.subject`,
            message: "Each switch branch needs a subject.",
          });
        }
        if (
          branch.subject !== "shopify_payment" &&
          !branch.subject_key?.trim()
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.subject_key`,
            message: "Each switch branch needs a subject key.",
          });
        }
        if (
          !branch.operator ||
          !["equals", "not_equals", "contains", "present", "absent"].includes(
            branch.operator,
          )
        ) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.operator`,
            message: "Each switch branch needs an operator.",
          });
        }
        if (!branch.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.next_node_key`,
            message: "Each switch branch must point to a next node.",
          });
        } else if (!knownKeys.has(branch.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: `${prefix}.next_node_key`,
            message: `Switch branch points to non-existent node "${branch.next_node_key}".`,
          });
        }
      });
      if (!cfg.default_next) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "default_next",
          message: "Switch needs a default (else) branch.",
        });
      } else if (!knownKeys.has(cfg.default_next)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "default_next",
          message: `Switch default points to non-existent node "${cfg.default_next}".`,
        });
      }
      break;
    }

    case "set_tag": {
      const cfg = node.config as {
        mode?: "add" | "remove";
        tag_id?: string;
        next_node_key?: string;
      };
      if (!cfg.mode || !["add", "remove"].includes(cfg.mode)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "mode",
          message: "Set-tag needs a mode (add or remove).",
        });
      }
      if (!cfg.tag_id) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "tag_id",
          message: "Set-tag needs a tag to apply.",
        });
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Set-tag must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Set-tag points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "send_template": {
      const cfg = node.config as {
        template_name?: string;
        next_node_key?: string;
        buttons?: Array<{ reply_id?: string; next_node_key?: string }>;
      };
      if (!cfg.template_name?.trim()) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "template_name",
          message: "Send-template node needs a template name.",
        });
      }
      const qrButtons = Array.isArray(cfg.buttons) ? cfg.buttons : [];
      if (qrButtons.length > 0) {
        for (const [i, btn] of qrButtons.entries()) {
          if (!btn.next_node_key) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `buttons.${i}.next_node_key`,
              message: `Quick-reply button "${btn.reply_id ?? i + 1}" needs a next node.`,
            });
          } else if (!knownKeys.has(btn.next_node_key)) {
            issues.push({
              severity: "error",
              scope: "node",
              node_key: node.node_key,
              field: `buttons.${i}.next_node_key`,
              message: `Button "${btn.reply_id}" points to non-existent node "${btn.next_node_key}".`,
            });
          }
        }
      }
      if (qrButtons.length === 0) {
        if (!cfg.next_node_key) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "next_node_key",
            message: "Send-template must connect Next step to a target node.",
          });
        } else if (!knownKeys.has(cfg.next_node_key)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "next_node_key",
            message: `Send-template Next step points to non-existent node "${cfg.next_node_key}".`,
          });
        }
      } else if (
        cfg.next_node_key &&
        !knownKeys.has(cfg.next_node_key)
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Send-template Next step points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "wait":
    case "send_webhook":
    case "http_fetch":
    case "update_contact_field":
    case "assign_conversation":
    case "create_deal":
    case "close_conversation": {
      const cfg = node.config as { next_node_key?: string; url?: string };
      if (node.node_type === "send_webhook" || node.node_type === "http_fetch") {
        if (!cfg.url?.trim()) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "url",
            message: "Outbound webhook node needs a URL.",
          });
        }
      }
      if (node.node_type === "create_deal") {
        const deal = node.config as {
          pipeline_id?: string;
          stage_id?: string;
          title?: string;
        };
        if (!nonEmpty(deal.pipeline_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "pipeline_id",
            message: "Create-deal node needs a sales pipeline.",
          });
        }
        if (!nonEmpty(deal.stage_id)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "stage_id",
            message: "Create-deal node needs a lead stage.",
          });
        }
        if (!nonEmpty(deal.title)) {
          issues.push({
            severity: "error",
            scope: "node",
            node_key: node.node_key,
            field: "title",
            message: "Create-deal node needs a title.",
          });
        }
      }
      if (!cfg.next_node_key) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: "Node must point to a next node.",
        });
      } else if (!knownKeys.has(cfg.next_node_key)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: node.node_key,
          field: "next_node_key",
          message: `Node points to non-existent node "${cfg.next_node_key}".`,
        });
      }
      break;
    }

    case "handoff":
    case "end":
      // Terminal nodes have no outgoing edges; nothing to validate
      // beyond their existence.
      break;

    default:
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Unknown node type "${node.node_type}".`,
      });
  }

  if (nodeTypeHasReplyTimeoutSlot(node.node_type)) {
    collectReplyTimeoutIssues(node, knownKeys, issues);
  }

  return issues;
}

// ============================================================
// Reachability — BFS from the entry, follow outgoing edges per node
// ============================================================

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map<string, NodeInput>();
  for (const n of nodes) byKey.set(n.node_key, n);

  const visited = new Set<string>();
  const queue: string[] = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    for (const next of outgoingEdges(node)) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function outgoingEdges(node: NodeInput): string[] {
  switch (node.node_type) {
    case "start":
    case "send_message":
    case "send_media":
    case "wait":
    case "send_webhook":
    case "http_fetch":
    case "update_contact_field":
    case "assign_conversation":
    case "create_deal":
    case "close_conversation":
    case "collect_input":
    case "send_address":
    case "set_tag": {
      const cfg = node.config as { next_node_key?: string };
      return cfg.next_node_key ? [cfg.next_node_key] : [];
    }
    case "send_template": {
      const cfg = node.config as {
        next_node_key?: string;
        buttons?: Array<{ next_node_key?: string }>;
      };
      const out: string[] = [];
      if (cfg.next_node_key) out.push(cfg.next_node_key);
      for (const b of cfg.buttons ?? []) {
        if (b.next_node_key) out.push(b.next_node_key);
      }
      return out;
    }
    case "condition": {
      const cfg = node.config as {
        true_next?: string;
        false_next?: string;
      };
      const out: string[] = [];
      if (cfg.true_next) out.push(cfg.true_next);
      if (cfg.false_next) out.push(cfg.false_next);
      return out;
    }
    case "switch": {
      const cfg = node.config as {
        default_next?: string;
        branches?: Array<{ next_node_key?: string }>;
      };
      const out: string[] = [];
      if (cfg.default_next) out.push(cfg.default_next);
      for (const b of cfg.branches ?? []) {
        if (b.next_node_key) out.push(b.next_node_key);
      }
      return out;
    }
    case "send_buttons": {
      const cfg = node.config as {
        buttons?: Array<{ next_node_key?: string }>;
      };
      return (cfg.buttons ?? [])
        .map((b) => b.next_node_key)
        .filter((k): k is string => !!k);
    }
    case "send_list": {
      const cfg = node.config as {
        sections?: Array<{ rows?: Array<{ next_node_key?: string }> }>;
      };
      const out: string[] = [];
      for (const s of cfg.sections ?? []) {
        for (const r of s.rows ?? []) {
          if (r.next_node_key) out.push(r.next_node_key);
        }
      }
      return out;
    }
    case "handoff":
    case "end":
    default:
      return [];
  }
}
