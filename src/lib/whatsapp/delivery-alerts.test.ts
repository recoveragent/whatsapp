import { describe, expect, it } from 'vitest';
import { alertCode, groupDeliveryAlerts, metaPaymentMessage, paymentIssueUrl } from './delivery-alerts';
import type { Notification } from '@/types';

const alert = (body: string, id = '1'): Notification => ({ id, account_id: 'account', user_id: 'user', type: 'message_failed', title: 'Failed', created_at: '2026-01-01', body });

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
    expect(groupDeliveryAlerts([first, alert('[131042] issue', '2'), alert('[131026] undeliverable', '3')]).map(([, items]) => items.length)).toEqual([2, 1]);
  });
});
