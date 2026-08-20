/**
 * Google Sheet row trigger — supports multiple lead-source sheets per flow.
 *
 * Legacy single-sheet configs (flat spreadsheet_id / sheet_name / …) are
 * normalized into `sources[0]` by ensureGoogleSheetRowConfig.
 */

export interface GoogleSheetSource {
  /** Stable id for watermark tracking across saves. */
  id: string
  /** Optional display label in the builder. */
  label?: string
  spreadsheet_id: string
  spreadsheet_url?: string
  sheet_name: string
  phone_column: string
  name_column?: string
  email_column?: string
  /** Flow var name → sheet column header */
  variable_mappings?: Record<string, string>
  /** 1-based header row. 0 = no header row (first row is a lead). */
  header_row?: number
  /** 1-based inclusive watermark (header = 1, or 0 when headerless). */
  last_processed_row?: number
  /**
   * When true on first poll (no watermark), process existing data rows.
   * When false (default), skip existing rows and only fire on new ones.
   */
  sync_existing?: boolean
}

export interface GoogleSheetRowTriggerConfig {
  sources: GoogleSheetSource[]
}

export function newGoogleSheetSourceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function defaultGoogleSheetSource(
  partial?: Partial<GoogleSheetSource>,
): GoogleSheetSource {
  return {
    id: partial?.id?.trim() || newGoogleSheetSourceId(),
    label: typeof partial?.label === 'string' ? partial.label : '',
    spreadsheet_id:
      typeof partial?.spreadsheet_id === 'string' ? partial.spreadsheet_id.trim() : '',
    spreadsheet_url:
      typeof partial?.spreadsheet_url === 'string' ? partial.spreadsheet_url : '',
    sheet_name: typeof partial?.sheet_name === 'string' ? partial.sheet_name.trim() : '',
    phone_column:
      typeof partial?.phone_column === 'string' && partial.phone_column.trim()
        ? partial.phone_column.trim()
        : 'phone',
    name_column:
      typeof partial?.name_column === 'string' ? partial.name_column : 'name',
    email_column:
      typeof partial?.email_column === 'string' ? partial.email_column : 'email',
    variable_mappings:
      partial?.variable_mappings && typeof partial.variable_mappings === 'object'
        ? (partial.variable_mappings as Record<string, string>)
        : {},
    header_row:
      typeof partial?.header_row === 'number' && Number.isFinite(partial.header_row)
        ? Math.max(0, Math.floor(partial.header_row))
        : undefined,
    last_processed_row:
      typeof partial?.last_processed_row === 'number' &&
      Number.isFinite(partial.last_processed_row)
        ? Math.max(0, Math.floor(partial.last_processed_row))
        : undefined,
    sync_existing: Boolean(partial?.sync_existing),
  }
}

export function defaultGoogleSheetRowConfig(): GoogleSheetRowTriggerConfig {
  return { sources: [defaultGoogleSheetSource()] }
}

function normalizeSource(raw: unknown): GoogleSheetSource | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<GoogleSheetSource>
  return defaultGoogleSheetSource(s)
}

/** Lift a legacy flat config into a single source. */
function legacyToSource(c: Record<string, unknown>): GoogleSheetSource {
  return defaultGoogleSheetSource({
    id: typeof c.source_id === 'string' ? c.source_id : undefined,
    spreadsheet_id: typeof c.spreadsheet_id === 'string' ? c.spreadsheet_id : '',
    spreadsheet_url: typeof c.spreadsheet_url === 'string' ? c.spreadsheet_url : '',
    sheet_name: typeof c.sheet_name === 'string' ? c.sheet_name : '',
    phone_column: typeof c.phone_column === 'string' ? c.phone_column : 'phone',
    name_column: typeof c.name_column === 'string' ? c.name_column : 'name',
    email_column: typeof c.email_column === 'string' ? c.email_column : 'email',
    variable_mappings:
      c.variable_mappings && typeof c.variable_mappings === 'object'
        ? (c.variable_mappings as Record<string, string>)
        : {},
    last_processed_row:
      typeof c.last_processed_row === 'number' ? c.last_processed_row : undefined,
    sync_existing: Boolean(c.sync_existing),
  })
}

export function ensureGoogleSheetRowConfig(
  config: Record<string, unknown> | null | undefined,
): GoogleSheetRowTriggerConfig {
  const c = (config ?? {}) as Record<string, unknown>

  if (Array.isArray(c.sources)) {
    const sources = c.sources
      .map(normalizeSource)
      .filter((s): s is GoogleSheetSource => s != null)
    return { sources: sources.length > 0 ? sources : [defaultGoogleSheetSource()] }
  }

  // Legacy flat shape → one source
  if (typeof c.spreadsheet_id === 'string' || typeof c.sheet_name === 'string') {
    return { sources: [legacyToSource(c)] }
  }

  return defaultGoogleSheetRowConfig()
}

/** Merge watermarks from previously saved sources onto the new config by source id. */
export function preserveGoogleSheetWatermarks(
  next: GoogleSheetRowTriggerConfig,
  prev: Record<string, unknown> | null | undefined,
): GoogleSheetRowTriggerConfig {
  const prevEnsured = ensureGoogleSheetRowConfig(prev)
  const prevById = new Map(prevEnsured.sources.map((s) => [s.id, s]))

  return {
    sources: next.sources.map((s) => {
      const old = prevById.get(s.id)
      if (!old) return s
      if (s.last_processed_row != null) return s
      if (old.last_processed_row == null) return s
      return { ...s, last_processed_row: old.last_processed_row }
    }),
  }
}
