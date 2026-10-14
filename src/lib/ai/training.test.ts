import { describe, expect, it } from 'vitest';
import {
  mergeTrainingFaqs,
  parseTrainingSuggestions,
  validateTrainingEdits,
} from './training';
import type { TrainingSource } from './training-types';

const sources: TrainingSource[] = [
  {
    id: 'page-1',
    url: 'https://gifts.example.com/policies/shipping',
    title: 'Gift shipping',
    text: 'Our personalized birth frames are made to order. Shipping is free on prepaid orders. COD costs ₹100 extra for Baby Birth Frame only.',
    fetchedAt: '2026-10-14',
  },
];
const suggestion = {
  question: 'Is shipping free for your personalized birth frames?',
  source_id: 'page-1',
  topic_quote: 'Our personalized birth frames are made to order.',
  answer_quote: 'Shipping is free on prepaid orders.',
};
const parse = (value: unknown) =>
  parseTrainingSuggestions(JSON.stringify(value), sources);
describe('website-grounded FAQ training', () => {
  it('copies only a continuous source excerpt and requires review', () => {
    expect(parse([suggestion])[0]).toMatchObject({
      answer: 'Shipping is free on prepaid orders.',
      approved: false,
      merchantEdited: false,
      sourceId: 'page-1',
    });
  });
  it('leaves fabricated or paraphrased answers blank', () => {
    expect(
      parse([
        {
          ...suggestion,
          answer_quote: 'We offer free express shipping to everyone!',
        },
      ])[0].answer
    ).toBe('');
  });
  it('leaves genuinely missing answers blank while keeping brand-specific questions', () => {
    expect(
      parse([
        {
          ...suggestion,
          question: 'Can I change the name on a personalized birth frame?',
          answer_quote: '',
        },
      ])[0].answer
    ).toBe('');
  });
  it('rejects invented source IDs and topics without website evidence', () => {
    expect(() => parse([{ ...suggestion, source_id: 'page-99' }])).toThrow(
      'No website-grounded'
    );
    expect(() =>
      parse([
        {
          ...suggestion,
          topic_quote: 'Luxury international fragrances and handbags.',
        },
      ])
    ).toThrow('No website-grounded');
  });
  it('deduplicates normalized questions', () => {
    expect(
      parse([
        suggestion,
        { ...suggestion, question: suggestion.question.toUpperCase() },
      ])
    ).toHaveLength(1);
  });
  it('preserves merchant edits on retraining and revokes approvals', () => {
    const original = parse([suggestion])[0];
    const edited = {
      ...original,
      answer: 'Merchant verified special exception.',
      merchantEdited: true,
      approved: true,
    };
    const next = mergeTrainingFaqs([edited], parse([suggestion]));
    expect(next[0]).toMatchObject({
      id: original.id,
      answer: edited.answer,
      approved: false,
      merchantEdited: true,
    });
  });
  it('blanks vanished automatic answers instead of retaining stale policies', () => {
    const original = parse([suggestion])[0];
    expect(mergeTrainingFaqs([original], [])[0]).toMatchObject({
      answer: '',
      approved: false,
      sourceId: null,
    });
  });
  it('refreshes automatic answers and keeps stable IDs', () => {
    const original = { ...parse([suggestion])[0], approved: true };
    expect(
      mergeTrainingFaqs(
        [original],
        parse([
          {
            ...suggestion,
            answer_quote: 'COD costs ₹100 extra for Baby Birth Frame only.',
          },
        ])
      )[0]
    ).toMatchObject({
      id: original.id,
      answer: 'COD costs ₹100 extra for Baby Birth Frame only.',
      approved: false,
    });
  });
  it('ignores client supplied source metadata and prevents blank approval', () => {
    const original = parse([suggestion])[0];
    const saved = validateTrainingEdits(
      [
        {
          ...original,
          answer: '',
          approved: true,
          sourceId: 'evil',
          generatedAnswer: 'invented',
        },
      ],
      [original]
    );
    expect(saved[0]).toMatchObject({
      answer: '',
      approved: false,
      merchantEdited: true,
      sourceId: 'page-1',
      generatedAnswer: original.answer,
    });
  });
  it('validates the worksheet size and field lengths', () => {
    expect(() => validateTrainingEdits(Array(101).fill({}), [])).toThrow('100');
    expect(() =>
      validateTrainingEdits([{ question: '', answer: '', approved: false }], [])
    ).toThrow('Questions');
    expect(() =>
      validateTrainingEdits(
        [{ question: 'Question?', answer: 'x'.repeat(3001), approved: true }],
        []
      )
    ).toThrow('3,000');
  });
  it('allows merchant-authored questions without claiming website provenance', () => {
    const result = validateTrainingEdits(
      [
        {
          id: 'new',
          question: 'Can you gift wrap our birth frames?',
          answer: 'Contact our team.',
          approved: true,
        },
      ],
      []
    );
    expect(result[0]).toMatchObject({
      sourceId: null,
      merchantEdited: true,
      approved: true,
    });
  });
  it('rejects invalid provider JSON without generating generic fallback questions', () => {
    expect(() =>
      parseTrainingSuggestions('Sorry, I cannot read this.', sources)
    ).toThrow();
    expect(() => parse({ questions: [] })).toThrow('not a question list');
  });
});
