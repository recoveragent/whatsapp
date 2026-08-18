/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + RecoverAgent tinted-pill classes here so the template
 * manager, inbox picker, and broadcast picker stay aligned.
 */

import type { MessageTemplateStatus } from '@/types';

export interface TemplateStatusDisplay {
  label: string;
  classes: string;
}

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: {
    label: 'Draft',
    classes: 'border-border bg-accent text-muted-foreground',
  },
  PENDING: {
    label: 'Pending',
    classes: 'border-amber-500/30 bg-amber-500/15 text-amber-700',
  },
  APPROVED: {
    label: 'Approved',
    classes: 'border-primary/25 bg-primary/15 text-primary',
  },
  REJECTED: {
    label: 'Rejected',
    classes: 'border-destructive/25 bg-destructive/15 text-destructive',
  },
  PAUSED: {
    label: 'Paused',
    classes: 'border-amber-500/30 bg-amber-500/15 text-amber-700',
  },
  DISABLED: {
    label: 'Disabled',
    classes: 'border-destructive/25 bg-destructive/15 text-destructive',
  },
  IN_APPEAL: {
    label: 'In Appeal',
    classes: 'border-secondary/25 bg-secondary/15 text-secondary',
  },
  PENDING_DELETION: {
    label: 'Pending Deletion',
    classes: 'border-border bg-accent text-muted-foreground',
  },
};
