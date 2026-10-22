import { describe, it, expect } from 'vitest'
import { knowledgeKeywords, knowledgeSearchText } from './knowledge-query'

describe('knowledgeKeywords', () => {
  it('drops English filler words', () => {
    expect(knowledgeKeywords('What is your return policy?')).toEqual(['return', 'policy'])
  })

  it('drops romanised Hindi and Tamil fillers', () => {
    expect(knowledgeKeywords('COD available hai kya bhai')).toEqual(['cod', 'available'])
    expect(knowledgeKeywords('delivery eppo varum sollunga')).toEqual(['delivery', 'varum'])
  })

  it('keeps non-Latin words and de-duplicates', () => {
    expect(knowledgeKeywords('எனது ஆர்டர் ஆர்டர்')).toEqual(['எனது', 'ஆர்டர்'])
  })

  it('returns nothing for a pure greeting', () => {
    expect(knowledgeKeywords('hi hello!!')).toEqual([])
  })
})

describe('knowledgeSearchText', () => {
  it('uses the latest customer message when it has enough keywords', () => {
    expect(
      knowledgeSearchText([
        { role: 'user', content: 'Do you ship to Dubai?' },
        { role: 'assistant', content: 'Yes we do.' },
        { role: 'user', content: 'What about refund timelines?' },
      ])
    ).toBe('What about refund timelines?')
  })

  it('carries the previous topic into a short follow-up', () => {
    expect(
      knowledgeSearchText([
        { role: 'user', content: 'How long does shipping take?' },
        { role: 'assistant', content: '3-5 days.' },
        { role: 'user', content: 'and for COD?' },
      ])
    ).toBe('How long does shipping take?\nand for COD?')
  })
})
