import type { LeadLanguage } from './types'

export function inferLeadLanguage(
  raw: string | undefined | null,
  fallback: LeadLanguage = 'en',
): LeadLanguage {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return fallback
  if (/^(hi|hin|hindi)/.test(v) || v.includes('हिंदी') || v.includes('हिन्दी')) {
    return 'hi'
  }
  if (/^(en|eng|english)/.test(v)) return 'en'
  return fallback
}

export function pickTemplateLanguage(
  rows: Array<{ language?: string | null }>,
  leadLanguage: LeadLanguage,
): string | null {
  const codes = rows
    .map((r) => r.language?.trim())
    .filter((c): c is string => Boolean(c))
  if (codes.length === 0) return null

  const prefix = leadLanguage === 'hi' ? 'hi' : 'en'
  const match = codes.find((c) => c.toLowerCase().startsWith(prefix))
  if (match) return match

  const en = codes.find((c) => c.toLowerCase().startsWith('en'))
  return en ?? codes[0] ?? null
}
