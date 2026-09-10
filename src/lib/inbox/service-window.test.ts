import { describe, expect, it } from 'vitest';

import {
  formatServiceWindowRemaining,
  getServiceWindow,
  isServiceWindowOpen,
  SERVICE_WINDOW_MS,
} from './service-window';

describe('getServiceWindow', () => {
  const customerAt = '2026-09-09T10:45:00.000Z';

  it('expires exactly 24 hours after the last customer message', () => {
    const endsAt = new Date(Date.parse(customerAt) + SERVICE_WINDOW_MS);

    expect(
      getServiceWindow(customerAt, endsAt).expired,
    ).toBe(true);
    expect(
      getServiceWindow(customerAt, new Date(endsAt.getTime() - 1)).expired,
    ).toBe(false);
  });

  it('shows precise remaining time instead of floored hours', () => {
    const now = new Date(Date.parse(customerAt) + 23 * 60 * 60 * 1000 + 55 * 60 * 1000);

    expect(getServiceWindow(customerAt, now)).toMatchObject({
      expired: false,
      remaining: '5m remaining',
    });
  });

  it('shows hours and minutes when both are meaningful', () => {
    const now = new Date(Date.parse(customerAt) + 22 * 60 * 60 * 1000 + 42 * 60 * 1000);

    expect(getServiceWindow(customerAt, now).remaining).toBe('1h 18m remaining');
  });

  it('treats missing customer messages as expired', () => {
    expect(getServiceWindow(null)).toMatchObject({
      expired: true,
      remaining: 'No customer messages',
    });
  });
});

describe('formatServiceWindowRemaining', () => {
  it('formats sub-hour windows in minutes', () => {
    expect(formatServiceWindowRemaining(55 * 60 * 1000)).toBe('55m remaining');
  });

  it('formats whole-hour windows without trailing minutes', () => {
    expect(formatServiceWindowRemaining(2 * 60 * 60 * 1000)).toBe('2h remaining');
  });
});

describe('isServiceWindowOpen', () => {
  it('returns false once the deadline passes', () => {
    const customerAt = '2026-09-09T16:15:00.000Z';
    const closedAt = new Date(Date.parse(customerAt) + SERVICE_WINDOW_MS);

    expect(isServiceWindowOpen(customerAt, closedAt)).toBe(false);
    expect(
      isServiceWindowOpen(customerAt, new Date(closedAt.getTime() - 60_000)),
    ).toBe(true);
  });
});
