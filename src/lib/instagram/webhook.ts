export type InstagramEvent = { accountId: string; participantId: string; messageId: string; direction: 'inbound' | 'outbound'; text: string; at: string };

/** Extract message events without treating Instagram-scoped IDs as phone numbers. */
export function parseInstagramEvents(body: unknown): InstagramEvent[] {
  if (!body || typeof body !== 'object') return [];
  const payload = body as { object?: unknown; entry?: unknown };
  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const events: InstagramEvent[] = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry.id !== 'string') continue;
    const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
    const changes = Array.isArray(entry.changes) ? entry.changes.filter((change: { field?: string }) => change?.field === 'messages').map((change: { value?: unknown }) => change.value) : [];
    for (const item of [...messaging, ...changes]) {
      const message = item?.message;
      const sender = item?.sender?.id;
      const recipient = item?.recipient?.id;
      if (typeof sender !== 'string' || typeof recipient !== 'string' || typeof message?.mid !== 'string') continue;
      const echo = message.is_echo === true;
      if ((echo ? sender : recipient) !== entry.id) continue;
      if (typeof message.text !== 'string' && !Array.isArray(message.attachments)) continue;
      const timestamp = Number(item.timestamp);
      if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8640000000000000) continue;
      const text = typeof message.text === 'string' && message.text ? message.text : '[Attachment]';
      events.push({ accountId: entry.id, participantId: echo ? recipient : sender, messageId: message.mid, direction: echo ? 'outbound' : 'inbound', text, at: new Date(timestamp).toISOString() });
    }
  }
  return events;
}
