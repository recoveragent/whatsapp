export interface GoogleSheetRowTriggerConfig {
  spreadsheet_id: string
  spreadsheet_url?: string
  sheet_name: string
  phone_column: string
  name_column?: string
  email_column?: string
  /** Flow var name → sheet column header */
  variable_mappings?: Record<string, string>
  /** 1-based inclusive watermark (header = 1). Next poll starts at last_processed_row + 1. */
  last_processed_row?: number
  /**
   * When true on first poll (no watermark), process existing data rows.
   * When false (default), skip existing rows and only fire on new ones.
   */
  sync_existing?: boolean
}

export function defaultGoogleSheetRowConfig(): GoogleSheetRowTriggerConfig {
  return {
    spreadsheet_id: '',
    spreadsheet_url: '',
    sheet_name: '',
    phone_column: 'phone',
    name_column: 'name',
    email_column: 'email',
    variable_mappings: {},
    sync_existing: false,
  }
}

export function ensureGoogleSheetRowConfig(
  config: Record<string, unknown> | null | undefined,
): GoogleSheetRowTriggerConfig {
  const base = defaultGoogleSheetRowConfig()
  const c = (config ?? {}) as Partial<GoogleSheetRowTriggerConfig>
  return {
    spreadsheet_id:
      typeof c.spreadsheet_id === 'string' ? c.spreadsheet_id.trim() : base.spreadsheet_id,
    spreadsheet_url:
      typeof c.spreadsheet_url === 'string' ? c.spreadsheet_url : base.spreadsheet_url,
    sheet_name: typeof c.sheet_name === 'string' ? c.sheet_name.trim() : base.sheet_name,
    phone_column:
      typeof c.phone_column === 'string' && c.phone_column.trim()
        ? c.phone_column.trim()
        : base.phone_column,
    name_column: typeof c.name_column === 'string' ? c.name_column : base.name_column,
    email_column: typeof c.email_column === 'string' ? c.email_column : base.email_column,
    variable_mappings:
      c.variable_mappings && typeof c.variable_mappings === 'object'
        ? (c.variable_mappings as Record<string, string>)
        : {},
    last_processed_row:
      typeof c.last_processed_row === 'number' && Number.isFinite(c.last_processed_row)
        ? Math.max(1, Math.floor(c.last_processed_row))
        : undefined,
    sync_existing: Boolean(c.sync_existing),
  }
}
