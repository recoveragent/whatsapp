import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small status / role pill used across the settings redesign
 * (Overview tiles, WhatsApp banner, the "Active" appearance markers).
 *
 * Status colours (emerald = good, amber = attention) follow the same
 * Tailwind palette the members tab already uses for role chips — they
 * are semantic accents, not neutrals, so they're intentionally not
 * tokenized. Neutrals stay on design tokens.
 */
export type ChipVariant = 'owner' | 'admin' | 'ok' | 'warn' | 'muted';

const VARIANTS: Record<ChipVariant, string> = {
  owner: 'border-amber-500/30 bg-amber-500/15 text-amber-700',
  admin: 'border-primary/25 bg-primary/15 text-primary',
  ok: 'border-primary/25 bg-primary/15 text-primary',
  warn: 'border-amber-500/30 bg-amber-500/15 text-amber-700',
  muted: 'border-border bg-accent text-muted-foreground',
};

export function SettingsChip({
  variant = 'muted',
  className,
  children,
}: {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small live status dot (e.g. WhatsApp connected indicator). */
export function StatusDot({
  tone = 'ok',
  className,
}: {
  tone?: 'ok' | 'muted';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-emerald-500' : 'bg-muted-foreground',
        className,
      )}
    />
  );
}
