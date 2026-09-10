export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ServiceWindowState = {
  expired: boolean;
  endsAt: Date | null;
  remainingMs: number;
  remaining: string;
};

function parseTimestamp(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date : null;
}

export function formatServiceWindowRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) return '<1m remaining';

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 1) {
    return minutes > 0 ? `${hours}h ${minutes}m remaining` : `${hours}h remaining`;
  }

  return `${totalMinutes}m remaining`;
}

export function getServiceWindow(
  lastCustomerMessageAt: string | Date | null | undefined,
  now: Date = new Date(),
): ServiceWindowState {
  if (!lastCustomerMessageAt) {
    return {
      expired: true,
      endsAt: null,
      remainingMs: 0,
      remaining: 'No customer messages',
    };
  }

  const startedAt = parseTimestamp(lastCustomerMessageAt);
  if (!startedAt) {
    return {
      expired: true,
      endsAt: null,
      remainingMs: 0,
      remaining: 'No customer messages',
    };
  }

  const endsAt = new Date(startedAt.getTime() + SERVICE_WINDOW_MS);
  const remainingMs = endsAt.getTime() - now.getTime();
  const expired = remainingMs <= 0;

  return {
    expired,
    endsAt,
    remainingMs: Math.max(0, remainingMs),
    remaining: expired ? 'Expired' : formatServiceWindowRemaining(remainingMs),
  };
}

export function isServiceWindowOpen(
  lastCustomerMessageAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return !getServiceWindow(lastCustomerMessageAt, now).expired;
}

export function lastCustomerMessageAtFromMessages(
  messages: ReadonlyArray<{ sender_type: string; created_at: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.sender_type === 'customer') {
      return message.created_at;
    }
  }
  return null;
}
