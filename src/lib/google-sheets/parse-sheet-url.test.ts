import { describe, expect, it } from 'vitest'

import { parseSheetGid, parseSpreadsheetId, quoteSheetName } from './parse-sheet-url'

describe('parseSpreadsheetId', () => {
  it('extracts id from edit URL', () => {
    expect(
      parseSpreadsheetId(
        'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
      ),
    ).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')
  })

  it('accepts bare id', () => {
    expect(parseSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    )
  })

  it('rejects empty / short strings', () => {
    expect(parseSpreadsheetId('')).toBeNull()
    expect(parseSpreadsheetId('not-a-sheet')).toBeNull()
  })
})

describe('parseSheetGid', () => {
  it('reads gid from hash and query', () => {
    expect(
      parseSheetGid(
        'https://docs.google.com/spreadsheets/d/abc/edit#gid=123',
      ),
    ).toBe(123)
    expect(
      parseSheetGid(
        'https://docs.google.com/spreadsheets/d/abc/edit?gid=456#gid=456',
      ),
    ).toBe(456)
  })

  it('returns null when gid is absent', () => {
    expect(parseSheetGid('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull()
  })
})

describe('quoteSheetName', () => {
  it('quotes and escapes single quotes', () => {
    expect(quoteSheetName("Leads")).toBe("'Leads'")
    expect(quoteSheetName("O'Brien")).toBe("'O''Brien'")
  })
})
