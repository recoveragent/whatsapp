'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  filterSettingsSections,
  type SettingsSection,
} from './settings-sections';

// Width at/above which the rail is a vertical column (already in view, so
// no auto-scroll needed). Mirrors the Tailwind `lg:` breakpoint that
// drives the row→column switch in the markup below — keep the two in sync.
const RAIL_DESKTOP_MIN_PX = 1024;

function sectionHref(
  section: SettingsSection,
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
) {
  const params = new URLSearchParams(searchParams.toString());
  params.set('tab', section);
  return `/settings?${params.toString()}`;
}

/**
 * The settings left rail — grouped, vertical on desktop and a
 * horizontal scroller on narrow screens (mirrors the mockup's ≤920px
 * behaviour). The active item auto-scrolls into view when the rail is
 * horizontal so a deep-linked section is never off-screen.
 *
 * Items are real links (not buttons + router.replace) so navigation stays
 * reliable even when a panel leaves a stacking-context / pointer trap
 * that would otherwise swallow click handlers.
 */
export function SettingsRail({
  active,
  hints,
}: {
  active: SettingsSection;
  /** @deprecated Prefer link navigation; kept optional for call-site compat. */
  onSelect?: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const { brandCategory } = useAuth();
  const searchParams = useSearchParams();
  const visibleSections = filterSettingsSections(SETTINGS_SECTIONS, brandCategory);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // When horizontal (mobile), keep the active chip in view. On desktop
  // the rail is a static column, so skip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(`(min-width: ${RAIL_DESKTOP_MIN_PX}px)`).matches) return;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [active]);

  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        'relative z-10 flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'border-b border-border',
        'lg:sticky lg:top-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0',
      )}
    >
      {RAIL_GROUPS.map(({ label, group }) => {
        const items = visibleSections.filter(
          (s) => SECTION_META[s].group === group,
        );
        return (
          <div
            key={group}
            className="flex shrink-0 gap-1 lg:flex-col lg:gap-0.5"
          >
            {label ? (
              <div className="hidden px-3 pt-3.5 pb-1.5 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground uppercase lg:block">
                {label}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              return (
                <Link
                  key={s}
                  ref={isActive ? activeRef : undefined}
                  href={sectionHref(s, searchParams)}
                  scroll={false}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors',
                    'lg:w-full',
                    isActive
                      ? 'bg-primary/15 font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{meta.label}</span>
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
