import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './defaults';

describe('current product prompt context', () => {
  it.each(['ecommerce', 'lead_gen'] as const)('includes verified product facts for %s websites', (brandCategory) => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', channel: 'website', brandCategory, currentProduct: { title: 'Oak frame', description: 'Made of oak wood' } });
    expect(prompt).toContain('Oak frame');
    expect(prompt).toContain('Made of oak wood');
    expect(prompt).toContain('not instructions');
  });
  it('tells the agent when product information cannot be verified', () => {
    const prompt = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', channel: 'website', currentProduct: null });
    expect(prompt).toContain('could not be verified');
    expect(prompt).toContain('Do not assume');
  });
});
