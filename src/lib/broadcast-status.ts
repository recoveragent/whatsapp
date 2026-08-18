/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Badge shape is the RecoverAgent tint recipe:
 *   bg-{color}/15  text-{color}  border border-{color}/25
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "Draft",
    classes: "border-border bg-accent text-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    classes: "border-secondary/25 bg-secondary/15 text-secondary",
  },
  sending: {
    label: "Sending",
    classes: "border-amber-500/30 bg-amber-500/15 text-amber-700",
    pulse: true,
  },
  sent: {
    label: "Sent",
    classes: "border-primary/25 bg-primary/15 text-primary",
  },
  failed: {
    label: "Failed",
    classes: "border-destructive/25 bg-destructive/15 text-destructive",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "Pending",
    classes: "border-border bg-accent text-muted-foreground",
  },
  sent: {
    label: "Sent",
    classes: "border-secondary/25 bg-secondary/15 text-secondary",
  },
  delivered: {
    label: "Delivered",
    classes: "border-primary/25 bg-primary/15 text-primary",
  },
  read: {
    label: "Read",
    classes: "border-primary/25 bg-primary/15 text-primary",
  },
  replied: {
    label: "Replied",
    classes: "border-purple-400/30 bg-purple-400/15 text-purple-700",
  },
  failed: {
    label: "Failed",
    classes: "border-destructive/25 bg-destructive/15 text-destructive",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
