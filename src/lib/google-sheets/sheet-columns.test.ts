import { describe, expect, it } from 'vitest'

import {
  detectHeaderRow,
  guessPhoneColumn,
  looksLikePhoneCell,
  scorePhoneHeader,
} from './sheet-columns'

describe('scorePhoneHeader', () => {
  it('prefers real phone headers over ad names that mention WhatsApp', () => {
    expect(scorePhoneHeader('phone_number')).toBeGreaterThan(
      scorePhoneHeader('ai voice over whatsapp'),
    )
    expect(scorePhoneHeader('ai voice over whatsapp')).toBe(0)
    expect(scorePhoneHeader('WhatsApp Number')).toBeGreaterThan(0)
  })
})

describe('looksLikePhoneCell', () => {
  it('accepts Facebook p: prefix and E.164', () => {
    expect(looksLikePhoneCell('p:+919633806963')).toBe(true)
    expect(looksLikePhoneCell('+1 2025551234')).toBe(true)
    expect(looksLikePhoneCell('Marketing 4 - Copy')).toBe(false)
    expect(looksLikePhoneCell('ai voice over whatsapp')).toBe(false)
  })
})

describe('detectHeaderRow', () => {
  it('detects a standard lead-export header row', () => {
    expect(
      detectHeaderRow([
        ['id', 'created_time', 'ad_name', 'full_name', 'phone_number', 'email'],
        ['l:1', '2026-01-01', 'Campaign', 'Ada', '919800000001', 'a@b.c'],
      ]),
    ).toBe(1)
  })

  it('returns 0 when the first rows are lead values, not headers', () => {
    expect(
      detectHeaderRow([
        [
          'l:1707',
          '2026-08-20T08:18:12-05:00',
          'ag:1202',
          'ai voice over whatsapp',
          'p:+919800000001',
        ],
        [
          'l:1708',
          '2026-08-20T09:00:00-05:00',
          'ag:1202',
          'ai voice over whatsapp',
          'p:+919800000002',
        ],
      ]),
    ).toBe(0)
  })
})

describe('guessPhoneColumn', () => {
  it('picks phone_number from headers', () => {
    expect(
      guessPhoneColumn(['id', 'ad_name', 'phone_number', 'full_name']),
    ).toBe('phone_number')
  })

  it('does not pick an ad name that contains whatsapp', () => {
    const headers = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const rows = [
      ['l:1', 'ts', 'ag:1', 'ai voice over whatsapp', 'Ada', 'a@b.c', 'p:+919800000001'],
      ['l:2', 'ts', 'ag:1', 'Marketing 4 - Copy', 'Bob', 'b@b.c', 'p:+919800000002'],
    ]
    expect(guessPhoneColumn(headers, rows)).toBe('G')
  })
})
