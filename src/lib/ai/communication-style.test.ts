import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, COMMUNICATION_STYLE_INSTRUCTIONS } from './defaults';

describe('communication style rules', () => {
  const cases = [
    { name: 'whatsapp draft', args: { mode: 'draft' as const } },
    { name: 'whatsapp auto reply', args: { mode: 'auto_reply' as const } },
    { name: 'website ecommerce', args: { mode: 'auto_reply' as const, channel: 'website' as const, brandCategory: 'ecommerce' as const } },
    { name: 'website lead gen', args: { mode: 'auto_reply' as const, channel: 'website' as const, brandCategory: 'lead_gen' as const } },
  ];

  it.each(cases)('are included for $name', ({ args }) => {
    const prompt = buildSystemPrompt({ userPrompt: null, ...args });
    expect(prompt).toContain(COMMUNICATION_STYLE_INSTRUCTIONS);
  });

  it('come before brand instructions so they cannot be read as overriding them', () => {
    const prompt = buildSystemPrompt({ userPrompt: 'Always be formal.', mode: 'auto_reply' });
    expect(prompt.indexOf(COMMUNICATION_STYLE_INSTRUCTIONS)).toBeLessThan(
      prompt.indexOf('Business context and instructions')
    );
  });

  it('forbid pressure tactics and never override factual rules', () => {
    expect(COMMUNICATION_STYLE_INSTRUCTIONS).toContain('never changes facts or overrides any other rule');
    expect(COMMUNICATION_STYLE_INSTRUCTIONS).toContain('no invented urgency, scarcity');
  });
});
