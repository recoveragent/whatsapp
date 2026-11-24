export type CommentRuleInput = {
  media_id: string | null; keywords: string[]; exclude_keywords: string[]; match_mode: 'word' | 'contains'; skip_mentions: boolean;
  public_replies: string[]; public_reply_limit: number; reply_text: string;
};

/** Trim, drop blanks and drop repeats that differ only by case. Null when the value is not a list of strings. */
function cleanList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return null;
  const unique = new Map<string, string>();
  for (const raw of value as string[]) {
    const item = raw.trim();
    if (item && !unique.has(item.toLowerCase())) unique.set(item.toLowerCase(), item);
  }
  return [...unique.values()];
}

/** Validate rule fields from the settings form. Returns an error message for the user, or the cleaned values. */
export function parseCommentRuleInput(body: unknown): { error: string } | { value: CommentRuleInput } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const mediaId = input.media_id === null || input.media_id === undefined || input.media_id === '' ? null : input.media_id;
  if (mediaId !== null && (typeof mediaId !== 'string' || !/^\d{1,40}$/.test(mediaId))) return { error: 'Choose a valid post.' };
  const keywords = cleanList(input.keywords);
  const exclude = cleanList(input.exclude_keywords ?? []);
  const publicReplies = cleanList(input.public_replies ?? []);
  if (!keywords || !exclude) return { error: 'Keywords must be text.' };
  if (!publicReplies) return { error: 'Public replies must be text.' };
  if ([keywords, exclude].some((list) => list.length > 30 || list.some((k) => k.length > 50))) return { error: 'Use up to 30 keywords of 50 characters each.' };
  if (publicReplies.length > 20 || publicReplies.some((r) => r.length > 300)) return { error: 'Use up to 20 public replies of 300 characters each.' };
  const mode = input.match_mode ?? 'word';
  if (mode !== 'word' && mode !== 'contains') return { error: 'Choose how keywords are matched.' };
  const skipMentions = input.skip_mentions ?? true;
  if (typeof skipMentions !== 'boolean') return { error: 'Choose whether to skip comments that tag someone.' };
  const limit = input.public_reply_limit ?? 100;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 1000) return { error: 'The public reply limit must be between 1 and 1,000.' };
  const text = typeof input.reply_text === 'string' ? input.reply_text.trim() : '';
  if (!text) return { error: 'Enter the message to send.' };
  // Instagram's limit is measured in UTF-8 bytes, so emoji and Indian scripts count for more than one.
  if (new TextEncoder().encode(text).length > 1000) return { error: 'The message is too long for Instagram. Shorten it.' };
  return { value: { media_id: mediaId, keywords, exclude_keywords: exclude, match_mode: mode, skip_mentions: skipMentions, public_replies: publicReplies, public_reply_limit: limit, reply_text: text } };
}
