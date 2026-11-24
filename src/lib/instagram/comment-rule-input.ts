export type CommentRuleInput = { media_id: string | null; keywords: string[]; reply_text: string };

/** Validate rule fields from the settings form. Returns an error message for the user, or the cleaned values. */
export function parseCommentRuleInput(body: unknown): { error: string } | { value: CommentRuleInput } {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const mediaId = input.media_id === null || input.media_id === undefined || input.media_id === '' ? null : input.media_id;
  if (mediaId !== null && (typeof mediaId !== 'string' || !/^\d{1,40}$/.test(mediaId))) return { error: 'Choose a valid post.' };
  if (!Array.isArray(input.keywords) || input.keywords.some((k) => typeof k !== 'string')) return { error: 'Keywords must be text.' };
  const keywords = [...new Map((input.keywords as string[]).map((k) => k.trim()).filter(Boolean).map((k) => [k.toLowerCase(), k])).values()];
  if (keywords.length > 20 || keywords.some((k) => k.length > 50)) return { error: 'Use up to 20 keywords of 50 characters each.' };
  const text = typeof input.reply_text === 'string' ? input.reply_text.trim() : '';
  if (!text) return { error: 'Enter the message to send.' };
  // Instagram's limit is measured in UTF-8 bytes, so emoji and Indian scripts count for more than one.
  if (new TextEncoder().encode(text).length > 1000) return { error: 'The message is too long for Instagram. Shorten it.' };
  return { value: { media_id: mediaId, keywords, reply_text: text } };
}
