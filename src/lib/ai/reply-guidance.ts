import type { SupabaseClient } from '@supabase/supabase-js';

/** A team correction on an AI reply, applied to similar messages later. */
export interface ReplyGuidance {
  id: string;
  message_id: string | null;
  conversation_id: string | null;
  customer_message: string;
  ai_reply: string;
  instruction: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const REPLY_GUIDANCE_COLUMNS =
  'id, message_id, conversation_id, customer_message, ai_reply, instruction, is_active, created_at, updated_at';

/**
 * Corrections sent to the model per reply. Accounts can keep any number
 * active; only the ones closest to the customer's message go in the prompt.
 */
export const PROMPT_REPLY_GUIDANCE_LIMIT = 12;
const LOAD_PAGE_SIZE = 1000;
export const MAX_INSTRUCTION_LENGTH = 1000;
const MAX_CUSTOMER_MESSAGE_LENGTH = 2000;
const MAX_AI_REPLY_LENGTH = 4000;

export interface GuidanceInput {
  instruction: string;
  customer_message: string;
  ai_reply: string;
}

/** Validate a create request body; returns an error message or the input. */
export function parseGuidanceInput(
  body: unknown
): { error: string } | GuidanceInput {
  if (!body || typeof body !== 'object') return { error: 'Invalid request.' };
  const b = body as Record<string, unknown>;
  const instruction =
    typeof b.instruction === 'string' ? b.instruction.trim() : '';
  if (!instruction) return { error: 'Describe how the agent should respond.' };
  if (instruction.length > MAX_INSTRUCTION_LENGTH)
    return {
      error: `Keep the instruction under ${MAX_INSTRUCTION_LENGTH} characters.`,
    };
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';
  return {
    instruction,
    customer_message: text(b.customer_message, MAX_CUSTOMER_MESSAGE_LENGTH),
    ai_reply: text(b.ai_reply, MAX_AI_REPLY_LENGTH),
  };
}

type GuidanceRow = Pick<ReplyGuidance, 'customer_message' | 'instruction'>;

/**
 * The active corrections that best fit the customer's latest message,
 * for the prompt. Never throws: a missing table (code shipped ahead of the
 * migration) or a read error just means the agent replies without them.
 */
export async function loadReplyGuidance(
  db: SupabaseClient,
  accountId: string,
  latestQuestion: string
): Promise<GuidanceRow[]> {
  const rows: GuidanceRow[] = [];
  try {
    for (let from = 0; ; from += LOAD_PAGE_SIZE) {
      const { data, error } = await db
        .from('ai_reply_guidance')
        .select('customer_message, instruction')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .range(from, from + LOAD_PAGE_SIZE - 1);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < LOAD_PAGE_SIZE) break;
    }
  } catch {
    // Use whatever loaded.
  }
  return selectRelevantGuidance(rows, latestQuestion);
}

const STOPWORDS = new Set(
  'a an and are as at be but by can do for from have hi hello how i if in is it me my of on or please so that the this to u want we what when where which with you your'.split(
    ' '
  )
);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

/**
 * Rank corrections by word overlap between their example and the
 * customer's message (newest wins ties, since rows arrive newest first).
 * Corrections saved without an example are general rules and fill any
 * remaining slots; unrelated examples are left out.
 */
export function selectRelevantGuidance(
  rows: GuidanceRow[],
  latestQuestion: string,
  limit = PROMPT_REPLY_GUIDANCE_LIMIT
): GuidanceRow[] {
  const query = terms(latestQuestion);
  const scored: { row: GuidanceRow; score: number }[] = [];
  const general: GuidanceRow[] = [];
  for (const row of rows) {
    if (!row.instruction.trim()) continue;
    const example = terms(row.customer_message);
    if (example.size === 0) {
      general.push(row);
      continue;
    }
    let shared = 0;
    for (const w of example) if (query.has(w)) shared++;
    if (shared > 0)
      scored.push({ row, score: shared / Math.sqrt(example.size * Math.max(query.size, 1)) });
  }
  scored.sort((a, b) => b.score - a.score);
  return [...scored.map((s) => s.row), ...general].slice(0, limit);
}

/** Prompt section for the corrections, or null when there are none. */
export function formatReplyGuidance(
  guidance: Pick<ReplyGuidance, 'customer_message' | 'instruction'>[]
): string | null {
  const rows = guidance.filter((g) => g.instruction.trim());
  if (rows.length === 0) return null;
  return rows
    .map((g, i) => {
      const example = g.customer_message.trim()
        ? `When a customer writes something like: "${g.customer_message.trim().slice(0, 300)}"\n`
        : '';
      return `[${i + 1}] ${example}Respond this way: ${g.instruction.trim()}`;
    })
    .join('\n\n');
}
