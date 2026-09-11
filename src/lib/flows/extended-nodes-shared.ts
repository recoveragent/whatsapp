/**
 * Client-safe helpers shared by the flow builder (validate.ts) and the
 * server-side extended node executor. Kept separate so Turbopack does
 * not pull server-only imports (webhooks, dispatch-triggers, etc.)
 * into the browser bundle.
 */

import { interpolateTemplateString } from '@/lib/flows/template-interpolate'
import type { ContactFieldMapping, UpdateContactFieldNodeConfig } from './types'

export interface WaitNodeConfig {
  /** Relative delay from now (default). Absolute: wait until a datetime var. */
  mode?: 'delay' | 'until'
  amount: number
  unit: 'minutes' | 'hours' | 'days'
  next_node_key: string
  /** Var key holding an ISO datetime (e.g. meeting_start). Used when mode=until. */
  datetime_var?: string
  /**
   * Minutes relative to datetime_var. Negative = before (e.g. -60 = 1h before).
   * Used when mode=until.
   */
  offset_minutes?: number
}

export function interpolateFlowVars(
  template: string,
  vars: Record<string, unknown>,
  messageText?: string,
): string {
  return interpolateTemplateString(template, vars, messageText)
}

export function resolveUpdateContactFieldEntries(
  cfg: UpdateContactFieldNodeConfig,
): ContactFieldMapping[] {
  if (cfg.fields?.length) {
    return cfg.fields.filter((entry) => entry.field?.trim())
  }
  if (cfg.field?.trim()) {
    return [{ field: cfg.field.trim(), value: cfg.value ?? '' }]
  }
  return []
}

function waitMs(cfg: WaitNodeConfig): number {
  const unitMs =
    cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

/**
 * Compute when a wait node should resume.
 * - mode delay (default): now + amount/unit
 * - mode until: vars[datetime_var] (+ optional offset_minutes)
 *   Prefers `${datetime_var}_iso` when present (raw ISO kept alongside formatted display).
 * Returns null if until-mode datetime is missing/invalid (caller should error).
 * If the computed time is already past, returns now (immediate continue via short wait
 * is handled by caller as continue).
 */
export function computeWaitRunAt(
  cfg: WaitNodeConfig,
  vars: Record<string, unknown>,
  nowMs: number = Date.now(),
): { runAt: string; immediate: boolean } | { error: string } {
  if (cfg.mode === 'until') {
    const key = (cfg.datetime_var ?? '').trim()
    if (!key) return { error: 'datetime_var required when wait mode is until' }
    const raw = vars[`${key}_iso`] ?? vars[key]
    if (raw == null || String(raw).trim() === '') {
      return { error: `datetime var "${key}" is missing` }
    }
    const base = Date.parse(String(raw).trim())
    if (Number.isNaN(base)) {
      return { error: `datetime var "${key}" is not a valid ISO datetime` }
    }
    const offset = Number(cfg.offset_minutes ?? 0)
    const target = base + (Number.isFinite(offset) ? offset : 0) * 60_000
    if (target <= nowMs) {
      return { runAt: new Date(nowMs).toISOString(), immediate: true }
    }
    return { runAt: new Date(target).toISOString(), immediate: false }
  }

  return {
    runAt: new Date(nowMs + waitMs(cfg)).toISOString(),
    immediate: false,
  }
}
