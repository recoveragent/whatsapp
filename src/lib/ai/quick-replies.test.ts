import { describe, expect, it } from 'vitest';
import { parseGeneration } from './generate';
import { replyButtonsForMessage } from './quick-replies';

describe('AI reply choices', () => {
  it('parses localized answer choices without leaking metadata into the reply', () => {
    expect(
      parseGeneration('कौन सा आकार?\n[[QUICK_REPLIES]]["A4","A3"]')
    ).toEqual({
      text: 'कौन सा आकार?',
      handoff: false,
      usage: null,
      quickReplies: ['A4', 'A3'],
    });
  });
  it.each([
    '["Yes",',
    '["Yes","No","Maybe","Later"]',
    '["Yes","yes"]',
    '["Yes",""]',
    '["Yes",42]',
    '["Yes","This label is much too long"]',
    '["Yes","**No**"]',
    '["Yes","No\\nthanks"]',
    '{"choices":["Yes","No"]}',
  ])(
    'drops invalid choices while keeping the usable question: %s',
    (trailer) => {
      expect(
        parseGeneration(`Need help?\n[[QUICK_REPLIES]]${trailer}`)
      ).toEqual({
        text: 'Need help?',
        handoff: false,
        usage: null,
      });
    }
  );
  it('never adds choices to a handoff or empty message', () => {
    expect(
      parseGeneration(
        'Team can help. [[HANDOFF]]\n[[QUICK_REPLIES]]["Yes","No"]'
      ).quickReplies
    ).toBeUndefined();
    expect(
      parseGeneration('[[QUICK_REPLIES]]["Yes","No"]').quickReplies
    ).toBeUndefined();
  });
  it('uses text for a body over the interactive limit instead of cutting it off', () => {
    expect(
      replyButtonsForMessage('x'.repeat(1024), ['Yes', 'No'])
    ).toHaveLength(2);
    expect(replyButtonsForMessage('x'.repeat(1025), ['Yes', 'No'])).toEqual([]);
  });
});
