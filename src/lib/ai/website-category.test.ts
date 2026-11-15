import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './defaults';

describe('website agent category', () => {
  it('uses support and demo guidance for lead management without store rules', () => {
    const prompt = buildSystemPrompt({
      userPrompt: 'Demo booking: https://example.com/demo',
      mode: 'auto_reply',
      channel: 'website',
      brandCategory: 'lead_gen',
      knowledge: ['We help businesses manage leads.'],
    });
    expect(prompt).toContain('support and sales assistant');
    expect(prompt).toContain('https://example.com/demo');
    expect(prompt).toContain('Do not ask for a phone number');
    expect(prompt).not.toContain('Commerce support rules');
    expect(prompt).not.toContain('No verified Shopify orders');
  });

  it('keeps ecommerce website guidance', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', channel: 'website', brandCategory: 'ecommerce' });
    expect(prompt).toContain('Commerce support rules');
    expect(prompt).toContain('No verified Shopify orders');
  });
});
