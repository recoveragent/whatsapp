'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
 * Real links support opening a section in another tab. Ordinary clicks
 * update the local panel through the page's native history navigation.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const t = useTranslations('Settings');
  const { brandCategory, ecommercePlatform } = useAuth();
  const searchParams = useSearchParams();
  const visibleSections = filterSettingsSections(
    SETTINGS_SECTIONS,
    brandCategory,
    ecommercePlatform,
  );
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
              <div className="hidden px-3 pt-4 pb-1.5 text-xs font-medium text-muted-foreground lg:block">
                {t(`groups.${group}`)}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              return (
                <a
                  key={s}
                  ref={isActive ? activeRef : undefined}
                  href={sectionHref(s, searchParams)}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onSelect(s);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-3 rounded-xl px-3 text-left text-sm whitespace-nowrap transition-colors',
                    'lg:w-full',
                    isActive
                      ? 'bg-card font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-border'
                      : 'text-foreground/80 hover:bg-card/60 hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[18px] shrink-0",
                      isActive ? "text-primary" : "text-foreground/70",
                    )}
                  />
                  <span className="flex-1">{t(`sections.${s}`)}</span>
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'hidden items-center gap-1.5 text-xs lg:inline-flex',
                        'text-muted-foreground',
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
