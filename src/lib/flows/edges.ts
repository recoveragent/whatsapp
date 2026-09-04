/**
 * Derive canvas edges from the flow's node list.
 *
 * Edges live INSIDE each node's `config` JSONB (each button row /
 * list row / condition branch carries its own `next_node_key`). The
 * canvas needs them as a separate `{ source, target, label,
 * sourceHandle }` list to render arrows, and the labels need to be
 * meaningful — a `send_buttons` node with three buttons isn't useful
 * on the canvas if the three outgoing arrows are unlabeled.
 *
 * Why this lives in lib/flows (not next to flow-canvas.tsx): the
 * derivation is pure data manipulation with no React-Flow types in
 * it, which makes it (a) trivially unit-testable and (b) reusable by
 * the editable canvas (PR 2) without dragging in client-only deps.
 *
 * `sourceHandle` ids are stable strings the canvas wires up to its
 * per-node renderer's outgoing connection points. They match the
 * scheme PR 2's drag-to-connect handler will read:
 *   - `next`            for single-outgoing nodes
 *   - `button:<reply_id>` for send_buttons rows
 *   - `row:<reply_id>`    for send_list rows
 *   - `true` / `false`    for condition branches
 *   - `branch:<branch_id>` / `default` for switch branches
 *   - `timeout`           for no-reply timeout branch on suspending nodes
 */

import type { BuilderNode } from "@/components/flows/shared";
import {
  NEXT_STEP_LABEL,
  REPLY_TIMEOUT_HANDLE,
  TIMEOUT_LABEL,
  nodeTypeHasReplyTimeoutSlot,
  showReplyTimeoutHandle,
} from "./reply-timeout";

function replyTimeoutNextKey(cfg: Record<string, unknown>): string | null {
  const next =
    typeof cfg.reply_timeout_next_node_key === "string"
      ? cfg.reply_timeout_next_node_key.trim()
      : "";
  return next || null;
}

function appendReplyTimeoutEdge(
  edges: CanvasEdge[],
  nodeKey: string,
  cfg: Record<string, unknown>,
  knownKeys: Set<string>,
): void {
  if (!showReplyTimeoutHandle(cfg)) return;
  const next = replyTimeoutNextKey(cfg);
  if (!next || !knownKeys.has(next)) return;
  edges.push({
    id: `${nodeKey}--timeout--${next}`,
    source: nodeKey,
    target: next,
    sourceHandle: REPLY_TIMEOUT_HANDLE,
    label: TIMEOUT_LABEL,
  });
}

function nextStepSlot(): OutgoingSlot {
  return { id: "next", label: NEXT_STEP_LABEL };
}

function replyTimeoutSlot(): OutgoingSlot {
  return { id: REPLY_TIMEOUT_HANDLE, label: TIMEOUT_LABEL };
}

function maybeAppendReplyTimeoutSlots(
  slots: OutgoingSlot[],
  cfg: Record<string, unknown>,
): OutgoingSlot[] {
  if (!showReplyTimeoutHandle(cfg)) return slots;
  return [...slots, replyTimeoutSlot()];
}

export interface CanvasEdge {
  /** Stable per-edge id — required by React-Flow. */
  id: string;
  /** node_key of the source node. */
  source: string;
  /** node_key of the target node. */
  target: string;
  /** Identifies which outgoing slot on the source node this edge belongs to. */
  sourceHandle: string;
  /** Human-readable label rendered on the canvas (e.g. "Yes button"). */
  label?: string;
}

export function deriveCanvasEdges(nodes: BuilderNode[]): CanvasEdge[] {
  const knownKeys = new Set(nodes.map((n) => n.node_key));
  const edges: CanvasEdge[] = [];

  for (const node of nodes) {
    const cfg = node.config;
    switch (node.node_type) {
      case "start":
      case "send_message":
      case "send_media":
      case "collect_input":
      case "send_address":
      case "send_flow":
      case "set_tag": {
        const next = (cfg as { next_node_key?: string }).next_node_key;
        if (next && knownKeys.has(next)) {
          edges.push({
            id: `${node.node_key}--next--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: "next",
          });
        }
        break;
      }

      case "condition": {
        const trueNext = (cfg as { true_next?: string }).true_next;
        const falseNext = (cfg as { false_next?: string }).false_next;
        if (trueNext && knownKeys.has(trueNext)) {
          edges.push({
            id: `${node.node_key}--true--${trueNext}`,
            source: node.node_key,
            target: trueNext,
            sourceHandle: "true",
            label: "true",
          });
        }
        if (falseNext && knownKeys.has(falseNext)) {
          edges.push({
            id: `${node.node_key}--false--${falseNext}`,
            source: node.node_key,
            target: falseNext,
            sourceHandle: "false",
            label: "false",
          });
        }
        break;
      }

      case "switch": {
        const branches = Array.isArray((cfg as { branches?: unknown }).branches)
          ? ((cfg as { branches: Array<Record<string, unknown>> }).branches)
          : [];
        for (const branch of branches) {
          const branchId =
            typeof branch.branch_id === "string" ? branch.branch_id : null;
          const next =
            typeof branch.next_node_key === "string"
              ? branch.next_node_key
              : null;
          const label =
            typeof branch.label === "string" ? branch.label : branchId;
          if (branchId && next && knownKeys.has(next)) {
            edges.push({
              id: `${node.node_key}--branch:${branchId}--${next}`,
              source: node.node_key,
              target: next,
              sourceHandle: `branch:${branchId}`,
              label: label ?? branchId,
            });
          }
        }
        const defaultNext = (cfg as { default_next?: string }).default_next;
        if (defaultNext && knownKeys.has(defaultNext)) {
          edges.push({
            id: `${node.node_key}--default--${defaultNext}`,
            source: node.node_key,
            target: defaultNext,
            sourceHandle: "default",
            label: "else",
          });
        }
        break;
      }

      case "send_buttons": {
        const buttons = Array.isArray(
          (cfg as { buttons?: unknown }).buttons,
        )
          ? ((cfg as { buttons: Array<Record<string, unknown>> }).buttons)
          : [];
        for (const btn of buttons) {
          const replyId =
            typeof btn.reply_id === "string" ? btn.reply_id : null;
          const next =
            typeof btn.next_node_key === "string" ? btn.next_node_key : null;
          const title = typeof btn.title === "string" ? btn.title : null;
          if (!replyId || !next || !knownKeys.has(next)) continue;
          edges.push({
            id: `${node.node_key}--button:${replyId}--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: `button:${replyId}`,
            label: title ?? replyId,
          });
        }
        break;
      }

      case "send_list": {
        const sections = Array.isArray(
          (cfg as { sections?: unknown }).sections,
        )
          ? ((cfg as { sections: Array<Record<string, unknown>> }).sections)
          : [];
        for (const section of sections) {
          const rows = Array.isArray(section.rows)
            ? (section.rows as Array<Record<string, unknown>>)
            : [];
          for (const row of rows) {
            const replyId =
              typeof row.reply_id === "string" ? row.reply_id : null;
            const next =
              typeof row.next_node_key === "string" ? row.next_node_key : null;
            const title = typeof row.title === "string" ? row.title : null;
            if (!replyId || !next || !knownKeys.has(next)) continue;
            edges.push({
              id: `${node.node_key}--row:${replyId}--${next}`,
              source: node.node_key,
              target: next,
              sourceHandle: `row:${replyId}`,
              label: title ?? replyId,
            });
          }
        }
        break;
      }

      case "send_template": {
        const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
          ? ((cfg as { buttons: Array<Record<string, unknown>> }).buttons)
          : [];
        for (const btn of buttons) {
          const replyId =
            typeof btn.reply_id === "string" ? btn.reply_id : null;
          const next =
            typeof btn.next_node_key === "string" ? btn.next_node_key : null;
          const title = typeof btn.title === "string" ? btn.title : null;
          if (!replyId || !next || !knownKeys.has(next)) continue;
          edges.push({
            id: `${node.node_key}--button:${replyId}--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: `button:${replyId}`,
            label: title ?? replyId,
          });
        }
        const next = (cfg as { next_node_key?: string }).next_node_key;
        if (next && knownKeys.has(next)) {
          edges.push({
            id: `${node.node_key}--next--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: "next",
            label: NEXT_STEP_LABEL,
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
        const next = (cfg as { next_node_key?: string }).next_node_key;
        if (next && knownKeys.has(next)) {
          edges.push({
            id: `${node.node_key}--next--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: "next",
          });
        }
        break;
      }

      case "handoff":
      case "end":
        // Terminal nodes — no outgoing edges.
        break;
    }
    if (nodeTypeHasReplyTimeoutSlot(node.node_type)) {
      appendReplyTimeoutEdge(edges, node.node_key, cfg, knownKeys);
    }
  }

  return edges;
}

// ============================================================
// Inverse operations — used by the canvas's drag-to-connect and
// delete-with-cleanup handlers (PR 2b). Kept in lib/flows so the
// canvas component stays free of edge-bookkeeping logic.
// ============================================================

/**
 * Outgoing-slot list for a node — used by the canvas to render one
 * source-side Handle per slot, labelled with the slot's user-facing
 * name. Order follows the order the slots appear in the node's
 * config so visual layout matches the form layout.
 *
 * Terminal nodes (handoff / end) return an empty list — they have
 * no outgoing edges and no source handles.
 */
export interface OutgoingSlot {
  /** Stable id matching the `sourceHandle` scheme used in
   *  CanvasEdge. */
  id: string;
  /** Visible label rendered next to the handle. */
  label: string;
}

export function outgoingSlots(node: BuilderNode): OutgoingSlot[] {
  const cfg = node.config;
  let slots: OutgoingSlot[];
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
    case "set_tag": {
      slots = [nextStepSlot()];
      break;
    }

    case "collect_input":
    case "send_address":
    case "send_flow": {
      slots = [nextStepSlot()];
      break;
    }

    case "send_template": {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? ((cfg as { buttons: Array<Record<string, unknown>> }).buttons)
        : [];
      slots = buttons
        .filter((b) => typeof b.reply_id === "string" && b.reply_id)
        .map((b) => {
          const replyId = b.reply_id as string;
          const title = typeof b.title === "string" ? b.title : null;
          return {
            id: `button:${replyId}`,
            label: title ?? replyId,
          };
        });
      slots.push(nextStepSlot());
      break;
    }

    case "condition":
      slots = [
        { id: "true", label: "true" },
        { id: "false", label: "false" },
      ];
      break;

    case "switch": {
      const branches = Array.isArray((cfg as { branches?: unknown }).branches)
        ? ((cfg as { branches: Array<Record<string, unknown>> }).branches)
        : [];
      slots = branches
        .filter((b) => typeof b.branch_id === "string" && b.branch_id)
        .map((b) => {
          const branchId = b.branch_id as string;
          const label = typeof b.label === "string" ? b.label : branchId;
          return { id: `branch:${branchId}`, label };
        });
      slots.push({ id: "default", label: "else" });
      break;
    }

    case "send_buttons": {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? ((cfg as { buttons: Array<Record<string, unknown>> }).buttons)
        : [];
      slots = buttons
        .filter((b) => typeof b.reply_id === "string" && b.reply_id)
        .map((b) => {
          const replyId = b.reply_id as string;
          const title = typeof b.title === "string" ? b.title : null;
          return {
            id: `button:${replyId}`,
            label: title ?? replyId,
          };
        });
      break;
    }

    case "send_list": {
      const sections = Array.isArray((cfg as { sections?: unknown }).sections)
        ? ((cfg as { sections: Array<Record<string, unknown>> }).sections)
        : [];
      slots = [];
      for (const section of sections) {
        const rows = Array.isArray(section.rows)
          ? (section.rows as Array<Record<string, unknown>>)
          : [];
        for (const row of rows) {
          const replyId =
            typeof row.reply_id === "string" ? row.reply_id : null;
          if (!replyId) continue;
          const title = typeof row.title === "string" ? row.title : null;
          slots.push({
            id: `row:${replyId}`,
            label: title ?? replyId,
          });
        }
      }
      break;
    }

    case "handoff":
    case "end":
      return [];
    default:
      return [];
  }

  if (nodeTypeHasReplyTimeoutSlot(node.node_type)) {
    return maybeAppendReplyTimeoutSlots(slots, cfg);
  }
  return slots;
}

/**
 * Compute the config patch to apply when the user drags an edge from
 * `sourceHandle` on a node to `targetKey`. Returns `null` when the
 * handle isn't recognised on the node type (defensive — React-Flow
 * would have to misroute for this to fire).
 *
 * For `send_buttons` and `send_list`, only the button/row with the
 * matching reply_id is patched; the rest of the array passes through
 * unchanged.
 */
export function applyEdgeConnection(
  node: BuilderNode,
  sourceHandle: string,
  targetKey: string,
): Record<string, unknown> | null {
  if (
    sourceHandle === REPLY_TIMEOUT_HANDLE &&
    nodeTypeHasReplyTimeoutSlot(node.node_type)
  ) {
    return { reply_timeout_next_node_key: targetKey };
  }

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
    case "send_flow":
    case "set_tag":
      if (sourceHandle === "next") return { next_node_key: targetKey };
      return null;

    case "send_template":
      if (sourceHandle === "next") return { next_node_key: targetKey };
      if (sourceHandle.startsWith("button:")) {
        const replyId = sourceHandle.slice("button:".length);
        const buttons = Array.isArray(
          (node.config as { buttons?: unknown }).buttons,
        )
          ? ((node.config as {
              buttons: Array<Record<string, unknown>>;
            }).buttons)
          : [];
        if (!buttons.some((b) => b.reply_id === replyId)) return null;
        return {
          buttons: buttons.map((b) =>
            b.reply_id === replyId ? { ...b, next_node_key: targetKey } : b,
          ),
        };
      }
      return null;

    case "condition":
      if (sourceHandle === "true") return { true_next: targetKey };
      if (sourceHandle === "false") return { false_next: targetKey };
      return null;

    case "switch": {
      if (sourceHandle === "default") return { default_next: targetKey };
      if (!sourceHandle.startsWith("branch:")) return null;
      const branchId = sourceHandle.slice("branch:".length);
      const branches = Array.isArray(
        (node.config as { branches?: unknown }).branches,
      )
        ? ((node.config as { branches: Array<Record<string, unknown>> })
            .branches)
        : [];
      if (!branches.some((b) => b.branch_id === branchId)) return null;
      return {
        branches: branches.map((b) =>
          b.branch_id === branchId ? { ...b, next_node_key: targetKey } : b,
        ),
      };
    }

    case "send_buttons": {
      if (!sourceHandle.startsWith("button:")) return null;
      const replyId = sourceHandle.slice("button:".length);
      const buttons = Array.isArray(
        (node.config as { buttons?: unknown }).buttons,
      )
        ? (node.config as {
            buttons: Array<Record<string, unknown>>;
          }).buttons
        : [];
      // No matching button → no-op (caller should have surfaced a
      // missing slot before letting the user drag).
      if (!buttons.some((b) => b.reply_id === replyId)) return null;
      return {
        buttons: buttons.map((b) =>
          b.reply_id === replyId ? { ...b, next_node_key: targetKey } : b,
        ),
      };
    }

    case "send_list": {
      if (!sourceHandle.startsWith("row:")) return null;
      const replyId = sourceHandle.slice("row:".length);
      const sections = Array.isArray(
        (node.config as { sections?: unknown }).sections,
      )
        ? (node.config as {
            sections: Array<Record<string, unknown>>;
          }).sections
        : [];
      let matched = false;
      const next = sections.map((s) => {
        const rows = Array.isArray(s.rows)
          ? (s.rows as Array<Record<string, unknown>>)
          : [];
        return {
          ...s,
          rows: rows.map((r) => {
            if (r.reply_id === replyId) {
              matched = true;
              return { ...r, next_node_key: targetKey };
            }
            return r;
          }),
        };
      });
      return matched ? { sections: next } : null;
    }

    case "handoff":
    case "end":
      return null;
    default:
      return null;
  }
}

/**
 * Walk every node and clear any `next_node_key` / `true_next` /
 * `false_next` / `button.next_node_key` / `row.next_node_key`
 * reference to `deletedKey`. Cleared refs become the empty string —
 * the same "no target picked" sentinel the builder forms use.
 *
 * Returns a new array; original nodes are left untouched. Nodes
 * without any matching reference pass through by identity to avoid
 * needless re-renders downstream.
 */
export function unlinkNodeReferences(
  nodes: BuilderNode[],
  deletedKey: string,
): BuilderNode[] {
  return nodes.map((n) => {
    const patched = patchedConfigWithoutKey(n, deletedKey);
    if (!patched) return n;
    return { ...n, config: patched };
  });
}

/**
 * Rename a node and rewrite every inbound `next_node_key` (and related
 * branch refs) that pointed at `oldKey` so they now point at `newKey`.
 *
 * Returns a new array; nodes without matching references pass through
 * by identity when only the renamed node's key changes.
 */
export function renameNodeReferences(
  nodes: BuilderNode[],
  oldKey: string,
  newKey: string,
): BuilderNode[] {
  if (oldKey === newKey) return nodes;
  return nodes.map((n) => {
    if (n.node_key === oldKey) {
      return { ...n, node_key: newKey };
    }
    const patched = patchedConfigRenamedKey(n, oldKey, newKey);
    if (!patched) return n;
    return { ...n, config: patched };
  });
}

function patchedConfigRenamedKey(
  node: BuilderNode,
  oldKey: string,
  newKey: string,
): Record<string, unknown> | null {
  const cfg = node.config;
  const timeoutNext = (cfg as { reply_timeout_next_node_key?: string })
    .reply_timeout_next_node_key;
  const timeoutMatch =
    timeoutNext === oldKey && nodeTypeHasReplyTimeoutSlot(node.node_type);

  const inner = patchedConfigRenamedKeyInner(node, oldKey, newKey);
  if (!inner && !timeoutMatch) return null;
  if (timeoutMatch) {
    return { ...(inner ?? cfg), reply_timeout_next_node_key: newKey };
  }
  return inner;
}

function patchedConfigRenamedKeyInner(
  node: BuilderNode,
  oldKey: string,
  newKey: string,
): Record<string, unknown> | null {
  const cfg = node.config;
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
    case "send_flow":
    case "set_tag": {
      const next = (cfg as { next_node_key?: string }).next_node_key;
      if (next !== oldKey) return null;
      return { ...cfg, next_node_key: newKey };
    }

    case "send_template": {
      const next = (cfg as { next_node_key?: string }).next_node_key;
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (cfg as { buttons: Array<Record<string, unknown>> }).buttons
        : [];
      const nextMatch = next === oldKey;
      const buttonMatch = buttons.some((b) => b.next_node_key === oldKey);
      if (!nextMatch && !buttonMatch) return null;
      return {
        ...cfg,
        ...(nextMatch ? { next_node_key: newKey } : {}),
        ...(buttonMatch
          ? {
              buttons: buttons.map((b) =>
                b.next_node_key === oldKey
                  ? { ...b, next_node_key: newKey }
                  : b,
              ),
            }
          : {}),
      };
    }

    case "condition": {
      const c = cfg as { true_next?: string; false_next?: string };
      const trueMatch = c.true_next === oldKey;
      const falseMatch = c.false_next === oldKey;
      if (!trueMatch && !falseMatch) return null;
      return {
        ...cfg,
        ...(trueMatch ? { true_next: newKey } : {}),
        ...(falseMatch ? { false_next: newKey } : {}),
      };
    }

    case "switch": {
      const c = cfg as {
        default_next?: string;
        branches?: Array<{ next_node_key?: string }>;
      };
      const defaultMatch = c.default_next === oldKey;
      const branches = Array.isArray(c.branches) ? c.branches : [];
      const branchMatch = branches.some((b) => b.next_node_key === oldKey);
      if (!defaultMatch && !branchMatch) return null;
      return {
        ...cfg,
        ...(defaultMatch ? { default_next: newKey } : {}),
        ...(branchMatch
          ? {
              branches: branches.map((b) =>
                b.next_node_key === oldKey
                  ? { ...b, next_node_key: newKey }
                  : b,
              ),
            }
          : {}),
      };
    }

    case "send_buttons": {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (cfg as {
            buttons: Array<Record<string, unknown>>;
          }).buttons
        : [];
      if (!buttons.some((b) => b.next_node_key === oldKey)) return null;
      return {
        ...cfg,
        buttons: buttons.map((b) =>
          b.next_node_key === oldKey ? { ...b, next_node_key: newKey } : b,
        ),
      };
    }

    case "send_list": {
      const sections = Array.isArray((cfg as { sections?: unknown }).sections)
        ? (cfg as {
            sections: Array<Record<string, unknown>>;
          }).sections
        : [];
      let dirty = false;
      const next = sections.map((s) => {
        const rows = Array.isArray(s.rows)
          ? (s.rows as Array<Record<string, unknown>>)
          : [];
        return {
          ...s,
          rows: rows.map((r) => {
            if (r.next_node_key === oldKey) {
              dirty = true;
              return { ...r, next_node_key: newKey };
            }
            return r;
          }),
        };
      });
      return dirty ? { ...cfg, sections: next } : null;
    }

    case "handoff":
    case "end":
      return null;
    default:
      return null;
  }
}

function patchedConfigWithoutKey(
  node: BuilderNode,
  deletedKey: string,
): Record<string, unknown> | null {
  const cfg = node.config;
  const timeoutNext = (cfg as { reply_timeout_next_node_key?: string })
    .reply_timeout_next_node_key;
  const timeoutMatch =
    timeoutNext === deletedKey && nodeTypeHasReplyTimeoutSlot(node.node_type);

  const inner = patchedConfigWithoutKeyInner(node, deletedKey);
  if (!inner && !timeoutMatch) return null;
  if (timeoutMatch) {
    return { ...(inner ?? cfg), reply_timeout_next_node_key: "" };
  }
  return inner;
}

function patchedConfigWithoutKeyInner(
  node: BuilderNode,
  deletedKey: string,
): Record<string, unknown> | null {
  const cfg = node.config;
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
    case "send_flow":
    case "set_tag": {
      const next = (cfg as { next_node_key?: string }).next_node_key;
      if (next !== deletedKey) return null;
      return { ...cfg, next_node_key: "" };
    }

    case "send_template": {
      const next = (cfg as { next_node_key?: string }).next_node_key;
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (cfg as { buttons: Array<Record<string, unknown>> }).buttons
        : [];
      const nextMatch = next === deletedKey;
      const buttonMatch = buttons.some((b) => b.next_node_key === deletedKey);
      if (!nextMatch && !buttonMatch) return null;
      return {
        ...cfg,
        ...(nextMatch ? { next_node_key: "" } : {}),
        ...(buttonMatch
          ? {
              buttons: buttons.map((b) =>
                b.next_node_key === deletedKey
                  ? { ...b, next_node_key: "" }
                  : b,
              ),
            }
          : {}),
      };
    }

    case "condition": {
      const c = cfg as { true_next?: string; false_next?: string };
      const trueMatch = c.true_next === deletedKey;
      const falseMatch = c.false_next === deletedKey;
      if (!trueMatch && !falseMatch) return null;
      return {
        ...cfg,
        ...(trueMatch ? { true_next: "" } : {}),
        ...(falseMatch ? { false_next: "" } : {}),
      };
    }

    case "switch": {
      const c = cfg as {
        default_next?: string;
        branches?: Array<{ next_node_key?: string }>;
      };
      const defaultMatch = c.default_next === deletedKey;
      const branches = Array.isArray(c.branches) ? c.branches : [];
      const branchMatch = branches.some((b) => b.next_node_key === deletedKey);
      if (!defaultMatch && !branchMatch) return null;
      return {
        ...cfg,
        ...(defaultMatch ? { default_next: "" } : {}),
        ...(branchMatch
          ? {
              branches: branches.map((b) =>
                b.next_node_key === deletedKey
                  ? { ...b, next_node_key: "" }
                  : b,
              ),
            }
          : {}),
      };
    }

    case "send_buttons": {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (cfg as {
            buttons: Array<Record<string, unknown>>;
          }).buttons
        : [];
      if (!buttons.some((b) => b.next_node_key === deletedKey)) return null;
      return {
        ...cfg,
        buttons: buttons.map((b) =>
          b.next_node_key === deletedKey ? { ...b, next_node_key: "" } : b,
        ),
      };
    }

    case "send_list": {
      const sections = Array.isArray((cfg as { sections?: unknown }).sections)
        ? (cfg as {
            sections: Array<Record<string, unknown>>;
          }).sections
        : [];
      let dirty = false;
      const next = sections.map((s) => {
        const rows = Array.isArray(s.rows)
          ? (s.rows as Array<Record<string, unknown>>)
          : [];
        return {
          ...s,
          rows: rows.map((r) => {
            if (r.next_node_key === deletedKey) {
              dirty = true;
              return { ...r, next_node_key: "" };
            }
            return r;
          }),
        };
      });
      return dirty ? { ...cfg, sections: next } : null;
    }

    case "handoff":
    case "end":
      return null;
    default:
      return null;
  }
}

