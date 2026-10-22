/** Convert the browser's local date/time input to a UTC instant. */
export function validateBroadcastSchedule(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) {
    throw new Error('Choose a date and time in the future.');
  }
  return date.toISOString();
}
