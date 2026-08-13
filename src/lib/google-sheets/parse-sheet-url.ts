/**
 * Extract a Google Spreadsheet ID from a pasted URL or raw id.
 *
 * Supports:
 * - https://docs.google.com/spreadsheets/d/{id}/edit...
 * - https://docs.google.com/spreadsheets/d/{id}
 * - bare spreadsheet id
 */
export function parseSpreadsheetId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (fromUrl?.[1]) return fromUrl[1]

  // Bare id: letters, digits, hyphen, underscore (typically 40+ chars)
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw

  return null
}

/** Sheet tab title safe for A1 notation (quote if needed). */
export function quoteSheetName(sheetName: string): string {
  const escaped = sheetName.replace(/'/g, "''")
  return `'${escaped}'`
}
