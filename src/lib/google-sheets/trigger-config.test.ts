import { describe, expect, it } from 'vitest'

import {
  ensureGoogleSheetRowConfig,
  preserveGoogleSheetWatermarks,
} from './trigger-config'

describe('ensureGoogleSheetRowConfig', () => {
  it('migrates legacy flat config into sources[0]', () => {
    const cfg = ensureGoogleSheetRowConfig({
      spreadsheet_id: 'abc123spreadsheetidxxxx',
      sheet_name: 'Leads',
      phone_column: 'phone_number',
      last_processed_row: 12,
    })
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0].spreadsheet_id).toBe('abc123spreadsheetidxxxx')
    expect(cfg.sources[0].sheet_name).toBe('Leads')
    expect(cfg.sources[0].phone_column).toBe('phone_number')
    expect(cfg.sources[0].last_processed_row).toBe(12)
  })

  it('keeps multiple sources', () => {
    const cfg = ensureGoogleSheetRowConfig({
      sources: [
        {
          id: 'a',
          spreadsheet_id: 'sheet1________________',
          sheet_name: 'A',
          phone_column: 'phone',
        },
        {
          id: 'b',
          spreadsheet_id: 'sheet2________________',
          sheet_name: 'B',
          phone_column: 'mobile',
        },
      ],
    })
    expect(cfg.sources).toHaveLength(2)
    expect(cfg.sources[1].phone_column).toBe('mobile')
  })
})

describe('preserveGoogleSheetWatermarks', () => {
  it('copies watermark by source id when missing on next', () => {
    const next = ensureGoogleSheetRowConfig({
      sources: [
        {
          id: 'a',
          spreadsheet_id: 'sheet1________________',
          sheet_name: 'A',
          phone_column: 'phone',
        },
      ],
    })
    const merged = preserveGoogleSheetWatermarks(next, {
      sources: [
        {
          id: 'a',
          spreadsheet_id: 'sheet1________________',
          sheet_name: 'A',
          phone_column: 'phone',
          last_processed_row: 40,
        },
      ],
    })
    expect(merged.sources[0].last_processed_row).toBe(40)
  })
})
