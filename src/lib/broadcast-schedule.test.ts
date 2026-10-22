import { describe, expect, it } from 'vitest';
import { validateBroadcastSchedule } from './broadcast-schedule';

describe('broadcast schedule', () => {
  const now = new Date('2026-10-23T10:00:00Z');
  it('preserves the chosen instant when converting to UTC', () => {
    expect(validateBroadcastSchedule('2026-10-23T18:30:00+05:30', now)).toBe('2026-10-23T13:00:00.000Z');
  });
  it.each(['', 'invalid', '2026-10-22T12:00:00Z', now.toISOString()])('rejects invalid or elapsed times: %s', (value) => {
    expect(() => validateBroadcastSchedule(value, now)).toThrow('future');
  });
});
