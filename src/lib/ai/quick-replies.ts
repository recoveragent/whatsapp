/** Provider-neutral trailer; stripped before any customer-facing text is sent. */
export const QUICK_REPLIES_MARKER = '[[QUICK_REPLIES]]';

export const QUICK_REPLIES_INSTRUCTIONS =
  'Reply buttons: when you ask a question with clear, short answer choices, offer 2–3 tappable replies. ' +
  'After your normal message, append a final line starting with [[QUICK_REPLIES]] followed by a JSON array of strings. ' +
  'Example:\nWould you like help choosing a size?\n[[QUICK_REPLIES]]["Yes, help me","Not now"]\n' +
  'Each label must be unique, plain text, at most 20 characters, and in the customer’s language. ' +
  'Buttons are customer answers, never claims that an action was performed. ' +
  'Only offer specific sizes, designs, prices or other product facts supported by the supplied business data. ' +
  'Do not invent options or force arbitrary choices for open questions such as a name, order number, address or birth details. ' +
  'For a yes/no question offer both answers. For more than three necessary choices, describe them in text instead of silently omitting choices. ' +
  'Do not add the trailer on handoff or when not asking a question. This trailer is the only exception to the message-text-only rule.';

/** Reject a whole invalid set rather than truncate a meaningful answer. */
export function validateQuickReplies(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) return [];
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return [];
    const label = item.trim();
    if (!label || label.length > 20 || /[\r\n\p{Cc}*_~`\[\]]/u.test(label))
      return [];
    if (
      labels.some((existing) => existing.toLowerCase() === label.toLowerCase())
    )
      return [];
    labels.push(label);
  }
  return labels;
}

export function parseQuickReplies(raw: string): {
  text: string;
  quickReplies: string[];
} {
  const index = raw.indexOf(QUICK_REPLIES_MARKER);
  if (index < 0) return { text: raw.trim(), quickReplies: [] };
  const text = raw.slice(0, index).trim();
  try {
    return {
      text,
      quickReplies: validateQuickReplies(
        JSON.parse(raw.slice(index + QUICK_REPLIES_MARKER.length).trim())
      ),
    };
  } catch {
    // A malformed/truncated trailer must never leak into WhatsApp.
    return { text, quickReplies: [] };
  }
}

/** Meta interactive bodies are limited to 1024 UTF-16 characters. */
export function replyButtonsForMessage(
  text: string,
  choices: unknown
): string[] {
  return text.trim() && text.length <= 1024
    ? validateQuickReplies(choices)
    : [];
}

export function withQuickReplyContext(text: string, choices: unknown): string {
  const labels = validateQuickReplies(choices);
  return labels.length ? `${text}\nReply choices: ${labels.join(' | ')}` : text;
}
