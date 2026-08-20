function columnLetter(index0: number): string {
  let n = index0 + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const HEADER_HINTS = new Set([
  'phone_number',
  'phone',
  'mobile',
  'full_name',
  'email',
  'created_time',
  'ad_id',
  'ad_name',
  'form_id',
  'campaign_name',
])

/** Facebook lead exports sometimes prefix phone cells with `p:`. */
export function normalizeSheetPhone(raw: string): string {
  return raw.trim().replace(/^p:/i, '').trim()
}

export function looksLikePhoneCell(raw: string | undefined): boolean {
  if (!raw) return false
  const digits = normalizeSheetPhone(String(raw)).replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}

/**
 * Score a header as a phone column.
 * Ad names like "ai voice over whatsapp" must not win.
 */
export function scorePhoneHeader(header: string): number {
  const n = header.trim().toLowerCase()
  if (!n) return 0
  if (n === 'phone_number' || n === 'phone' || n === 'mobile') return 100
  if (/^(phone|mobile)([_\s-]|$)/.test(n)) return 90
  if (/\bphone\b|\bmobile\b/.test(n)) return 70
  if (/whatsapp/.test(n) && /(number|phone|mobile)/.test(n)) return 60
  return 0
}

export function rowLooksLikeHeaders(cells: string[]): boolean {
  const lower = cells.map((c) => c.trim().toLowerCase()).filter(Boolean)
  if (lower.length === 0) return false
  let hits = 0
  for (const c of lower) {
    if (HEADER_HINTS.has(c)) hits += 1
    else if (scorePhoneHeader(c) >= 70) hits += 1
  }
  return hits >= 2
}

/** 1-based header row, or 0 when the sheet is headerless (first row is data). */
export function detectHeaderRow(rows: string[][]): number {
  if (rows[0] && rowLooksLikeHeaders(rows[0])) return 1
  if (rows[1] && rowLooksLikeHeaders(rows[1])) return 2
  return 0
}

export function columnLetters(count: number): string[] {
  const n = Math.max(0, count)
  return Array.from({ length: n }, (_, i) => columnLetter(i))
}

export function guessPhoneColumn(
  headers: string[],
  dataRows: string[][] = [],
): string {
  const named = headers
    .map((h) => ({ h, score: scorePhoneHeader(h) }))
    .sort((a, b) => b.score - a.score)
  if (named[0] && named[0].score >= 50) return named[0].h

  const colCount = Math.max(
    headers.length,
    ...dataRows.map((r) => r.length),
    0,
  )
  let bestIdx = -1
  let bestHits = 0
  for (let i = 0; i < colCount; i++) {
    let hits = 0
    for (const row of dataRows) {
      if (looksLikePhoneCell(row[i])) hits += 1
    }
    if (hits > bestHits) {
      bestHits = hits
      bestIdx = i
    }
  }
  if (bestIdx >= 0 && bestHits > 0) {
    return headers[bestIdx] || columnLetter(bestIdx)
  }
  return headers[0] || 'phone'
}

export function guessNameColumn(headers: string[]): string {
  const exact =
    headers.find((h) => /^full_name$/i.test(h.trim())) ||
    headers.find((h) => /^name$/i.test(h.trim()))
  if (exact) return exact
  const fuzzy = headers.find((h) => /full.?name/i.test(h.trim()))
  return fuzzy || 'name'
}

export function guessEmailColumn(headers: string[]): string {
  return headers.find((h) => /email/i.test(h.trim())) || 'email'
}
