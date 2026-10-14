import { randomUUID } from 'node:crypto';
import type { TrainingFaq, TrainingSource } from './training-types';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const key = (value: string) =>
  normalize(value)
    .toLocaleLowerCase()
    .replace(/[?？]+$/, '');

/** Only exact website excerpts may become automatic answers. No model prose. */
export function parseTrainingSuggestions(
  raw: string,
  sources: TrainingSource[]
): TrainingFaq[] {
  const json = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed))
    throw new Error(
      'Training response was not a question list. Retry generation.'
    );
  const seen = new Set<string>();
  const result: TrainingFaq[] = [];
  for (const item of parsed.slice(0, 40)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const question =
      typeof row.question === 'string' ? normalize(row.question) : '';
    const topicQuote =
      typeof row.topic_quote === 'string' ? normalize(row.topic_quote) : '';
    const source = sources.find((source) => source.id === row.source_id);
    if (
      !source ||
      question.length < 8 ||
      question.length > 250 ||
      topicQuote.length < 8 ||
      topicQuote.length > 600 ||
      seen.has(key(question))
    )
      continue;
    const text = normalize(source.text);
    // Even an unanswered question needs website evidence for brand relevance.
    if (!text.includes(topicQuote)) continue;
    const candidate =
      typeof row.answer_quote === 'string' ? normalize(row.answer_quote) : '';
    const answer =
      candidate.length >= 8 &&
      candidate.length <= 2500 &&
      text.includes(candidate)
        ? candidate
        : '';
    seen.add(key(question));
    result.push({
      id: randomUUID(),
      question,
      answer,
      generatedAnswer: answer,
      sourceId: source.id,
      topicQuote,
      merchantEdited: false,
      approved: false,
    });
  }
  if (!result.length)
    throw new Error(
      'No website-grounded questions were found. Try a more specific website page or add questions manually.'
    );
  return result;
}

/** Keep merchant work; refresh generated answers and require renewed approval. */
export function mergeTrainingFaqs(
  previous: TrainingFaq[],
  generated: TrainingFaq[]
): TrainingFaq[] {
  const next = new Map(generated.map((faq) => [key(faq.question), faq]));
  const result: TrainingFaq[] = [];
  for (const old of previous) {
    const replacement = next.get(key(old.question));
    next.delete(key(old.question));
    if (old.merchantEdited) result.push({ ...old, approved: false });
    else if (replacement) result.push({ ...replacement, id: old.id });
    else
      result.push({
        ...old,
        answer: '',
        generatedAnswer: '',
        sourceId: null,
        topicQuote: '',
        approved: false,
      });
  }
  return [...result, ...next.values()].slice(0, 100);
}

/** Client supplies editable fields only; source metadata always comes from stored draft. */
export function validateTrainingEdits(
  value: unknown,
  stored: TrainingFaq[]
): TrainingFaq[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Use at most 100 questions.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid question.');
    const question =
      typeof item.question === 'string' ? item.question.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    if (
      !question ||
      question.length > 250 ||
      answer.length > 3000 ||
      typeof item.approved !== 'boolean'
    )
      throw new Error(
        'Questions must be 1–250 characters and answers at most 3,000 characters.'
      );
    const old = stored.find((row) => row.id === item.id);
    const id = old?.id ?? randomUUID();
    if (ids.has(id)) throw new Error('Duplicate question ID.');
    ids.add(id);
    const changed = !old || question !== old.question || answer !== old.answer;
    return {
      id,
      question,
      answer,
      sourceId: old?.sourceId ?? null,
      topicQuote: old?.topicQuote ?? '',
      generatedAnswer: old?.generatedAnswer ?? '',
      merchantEdited: changed || old?.merchantEdited === true,
      approved: !!answer && item.approved,
    };
  });
}

export function approvedTrainingContent(
  faqs: TrainingFaq[],
  sources: TrainingSource[]
): string[] {
  return faqs
    .filter((faq) => faq.approved && faq.answer.trim())
    .map((faq) => {
      const source = sources.find((source) => source.id === faq.sourceId);
      return `Q: ${faq.question}\nA: ${faq.answer}\n${faq.merchantEdited ? 'Answer reviewed and supplied/edited by merchant.' : `Website excerpt. Source: ${source?.url ?? 'previously reviewed website'}`}`;
    });
}
