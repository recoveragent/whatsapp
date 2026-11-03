import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './defaults';
import {
  formatReplyGuidance,
  MAX_INSTRUCTION_LENGTH,
  parseGuidanceInput,
  PROMPT_REPLY_GUIDANCE_LIMIT,
  selectRelevantGuidance,
} from './reply-guidance';

describe('parseGuidanceInput', () => {
  it('requires an instruction', () => {
    expect(parseGuidanceInput({ instruction: '   ' })).toEqual({
      error: 'Describe how the agent should respond.',
    });
    expect(parseGuidanceInput(null)).toEqual({ error: 'Invalid request.' });
  });

  it('rejects an over-long instruction', () => {
    const result = parseGuidanceInput({
      instruction: 'x'.repeat(MAX_INSTRUCTION_LENGTH + 1),
    });
    expect(result).toHaveProperty('error');
  });

  it('trims fields and caps the stored examples', () => {
    expect(
      parseGuidanceInput({
        instruction: '  Ask for size first ',
        customer_message: ' I want a photo clock ',
        ai_reply: 'y'.repeat(5000),
      })
    ).toEqual({
      instruction: 'Ask for size first',
      customer_message: 'I want a photo clock',
      ai_reply: 'y'.repeat(4000),
    });
  });
});

describe('formatReplyGuidance', () => {
  it('returns null when there is nothing to apply', () => {
    expect(formatReplyGuidance([])).toBeNull();
    expect(
      formatReplyGuidance([{ customer_message: 'hi', instruction: '  ' }])
    ).toBeNull();
  });

  it('pairs each example with its correction', () => {
    const text = formatReplyGuidance([
      {
        customer_message: 'I want to order photo clock',
        instruction: 'Ask which size and shape first.',
      },
      { customer_message: '', instruction: 'Always greet by name.' },
    ]);
    expect(text).toBe(
      '[1] When a customer writes something like: "I want to order photo clock"\n' +
        'Respond this way: Ask which size and shape first.\n\n' +
        '[2] Respond this way: Always greet by name.'
    );
  });
});

describe('selectRelevantGuidance', () => {
  const clock = { customer_message: 'I want to order photo clock', instruction: 'Ask size first.' };
  const lamp = { customer_message: 'Do you have illusion lamps?', instruction: 'Share lamp range.' };
  const general = { customer_message: '', instruction: 'Always greet by name.' };

  it('keeps matching examples and general rules, drops unrelated ones', () => {
    expect(
      selectRelevantGuidance([lamp, general, clock], 'Need a photo wall clock')
    ).toEqual([clock, general]);
  });

  it('ranks the closest example first and respects the limit', () => {
    const wallet = { customer_message: 'photo wallet price', instruction: 'Quote wallet.' };
    const rows = [wallet, clock];
    expect(selectRelevantGuidance(rows, 'order a photo clock')[0]).toBe(clock);
    expect(selectRelevantGuidance(rows, 'order a photo clock', 1)).toEqual([clock]);
  });

  it('has no ceiling on stored corrections, only on what goes in the prompt', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      customer_message: `photo clock ${i}`,
      instruction: `Rule ${i}`,
    }));
    expect(selectRelevantGuidance(many, 'photo clock')).toHaveLength(
      PROMPT_REPLY_GUIDANCE_LIMIT
    );
  });
});

describe('buildSystemPrompt reply corrections', () => {
  it('adds the corrections section only when provided', () => {
    const base = { userPrompt: null, mode: 'auto_reply' as const };
    expect(buildSystemPrompt(base)).not.toContain('Reply corrections');
    const prompt = buildSystemPrompt({
      ...base,
      replyGuidance: '[1] Respond this way: Ask which size first.',
    });
    expect(prompt).toContain('Reply corrections from the business');
    expect(prompt).toContain('Ask which size first.');
  });
});
