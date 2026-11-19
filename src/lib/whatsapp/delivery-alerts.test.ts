import { describe, expect, it } from 'vitest';
import { alertCode, alertInGroup, groupDeliveryAlerts, metaPaymentMessage, metaReason, paymentIssueUrl, plural } from './delivery-alerts';
import type { Notification } from '@/types';

const alert = (body: string, id = '1', created_at = '2026-01-01', conversation_id?: string): Notification => ({ id, account_id: 'account', user_id: 'user', type: 'message_failed', title: 'Failed', created_at, body, conversation_id });

describe('delivery alerts', () => {
  it('accepts only the Meta Business HTTPS link in a payment error', () => {
    expect(paymentIssueUrl(alert('[131042] Visit https://business.facebook.com/billing?client=one.'))).toBe('https://business.facebook.com/billing?client=one');
    expect(paymentIssueUrl(alert('[131042] https://business.facebook.com.evil.test/billing'))).toBeNull();
    expect(paymentIssueUrl(alert('[131042] http://business.facebook.com/billing'))).toBeNull();
    expect(paymentIssueUrl(alert('[131026] https://business.facebook.com/billing'))).toBeNull();
  });
  it('groups matching codes and retains the actual Meta message', () => {
    const first = alert('Contact: [131042] Payment issue Visit https://business.facebook.com/x Check WhatsApp billing in Meta Business Manager, including country, currency and payment method.');
    expect(alertCode(first)).toBe('131042');
    expect(metaPaymentMessage(first)).toBe('Payment issue Visit [payment link]');
    expect(groupDeliveryAlerts([first, alert('[131042] issue', '2'), alert('[131026] undeliverable', '3')]).map((g) => g.alerts.length)).toEqual([2, 1]);
  });
  it('labels groups by Meta code and sorts by severity then size', () => {
    const groups = groupDeliveryAlerts([
      alert('A: [131047] Re-engagement message', '1', '2026-01-01', 'c1'),
      alert('B: [131047] Re-engagement message', '2', '2026-01-03', 'c1'),
      alert('C: [131047] Re-engagement message', '3', '2026-01-02', 'c2'),
      alert('D: [132015] Template paused', '4'),
      alert('E: [999999] Strange failure Open the chat to review the failed message before retrying.', '5'),
      alert('F: [131042] Payment', '6'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['131042', '132015', '999999', '131047']);
    expect(groups[3]).toMatchObject({ title: '24-hour window closed', severity: 'recipient', conversations: 2, latestAt: '2026-01-03' });
    expect(groups[2].title).toBe('Strange failure (999999)');
  });
  it('reads the Meta reason and matches group keys', () => {
    expect(metaReason(alert('Ann: [131026] Message undeliverable; [1] x'))).toBe('Message undeliverable');
    expect(alertInGroup(alert('[131047] x'), '131047')).toBe(true);
    expect(alertInGroup(alert('no code'), 'other')).toBe(true);
    expect(alertInGroup({ ...alert('[131047] x'), type: 'conversation_assigned' }, '131047')).toBe(false);
    expect(plural(1, 'conversation')).toBe('1 conversation');
    expect(plural(2, 'conversation')).toBe('2 conversations');
  });
});
