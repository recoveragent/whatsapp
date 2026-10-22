'use client';

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/**
 * Lets a page lift its own controls (search, primary CTA, per-record
 * actions) into the dark top bar on desktop. The header renders the
 * slot targets; pages wrap controls in <TopBarPortal>. Below lg — and in
 * embed mode, where there is no header — children render inline, so
 * callers keep their normal mobile layout.
 */

type Slot = 'start' | 'center';

interface SlotTargets {
  start: HTMLElement | null;
  center: HTMLElement | null;
  setStart: (el: HTMLElement | null) => void;
  setCenter: (el: HTMLElement | null) => void;
}

const TopBarSlotsContext = createContext<SlotTargets | null>(null);

export function TopBarSlotsProvider({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [center, setCenter] = useState<HTMLElement | null>(null);
  return (
    <TopBarSlotsContext.Provider value={{ start, center, setStart, setCenter }}>
      {children}
    </TopBarSlotsContext.Provider>
  );
}

/** Rendered by the header — the element portaled controls mount into. */
export function TopBarSlotTarget({
  slot,
  className,
}: {
  slot: Slot;
  className?: string;
}) {
  const ctx = useContext(TopBarSlotsContext);
  return (
    <div
      ref={slot === 'start' ? ctx?.setStart : ctx?.setCenter}
      className={cn('hidden min-w-0 items-center gap-2 lg:flex', className)}
    />
  );
}

const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribeDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false
  );
}

/** True when controls wrapped in <TopBarPortal slot> will land in the top bar. */
export function useTopBarSlotActive(slot: Slot): boolean {
  const ctx = useContext(TopBarSlotsContext);
  const isDesktop = useIsDesktop();
  return isDesktop && !!ctx?.[slot];
}

export function TopBarPortal({
  slot,
  children,
}: {
  slot: Slot;
  children: ReactNode;
}) {
  const ctx = useContext(TopBarSlotsContext);
  const active = useTopBarSlotActive(slot);
  const target = ctx?.[slot];
  if (active && target) return createPortal(children, target);
  return <>{children}</>;
}
