import { describe, expect, it } from 'vitest';
import { hasReportedDeliveryHold, withMetaAcceptance } from './delivery-hold';

describe('Meta delivery holds', () => {
  it('preserves the template snapshot and does not infer an unreported hold', () => {
    const snapshot = { type: 'template', template: { body: 'Order update' } };
    expect(withMetaAcceptance(snapshot, 'held_for_quality_assessment')).toEqual(
      {
        ...snapshot,
        meta_message_status: 'held_for_quality_assessment',
      }
    );
    expect(withMetaAcceptance(snapshot)).toBe(snapshot);
    expect(withMetaAcceptance(null)).toBeNull();
  });

  it('stops displaying the reported hold after delivery, read, or failure', () => {
    const content_payload = withMetaAcceptance(
      null,
      'held_for_quality_assessment'
    );
    expect(hasReportedDeliveryHold({ status: 'sent', content_payload })).toBe(
      true
    );
    for (const status of ['sending', 'delivered', 'read', 'failed'] as const) {
      expect(hasReportedDeliveryHold({ status, content_payload })).toBe(false);
    }
    expect(
      hasReportedDeliveryHold({ status: 'sent', content_payload: null })
    ).toBe(false);
    expect(
      hasReportedDeliveryHold({
        status: 'sent',
        content_payload: withMetaAcceptance(null, 'accepted'),
      })
    ).toBe(false);
  });
});
