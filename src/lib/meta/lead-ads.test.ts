import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  extractLeadgenChanges,
  normalizeMetaLead,
  verifyMetaWebhookSignature,
} from './lead-ads';

describe('Meta Lead Ads webhook helpers', () => {
  it('verifies sha256 webhook signatures', () => {
    const body = '{"object":"page"}';
    const secret = 'app-secret';
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(`${body}x`, signature, secret)).toBe(
      false
    );
  });

  it('extracts leadgen changes and ignores unrelated fields', () => {
    expect(
      extractLeadgenChanges({
        object: 'page',
        entry: [
          {
            id: 'page-1',
            changes: [
              { field: 'feed', value: {} },
              {
                field: 'leadgen',
                value: {
                  leadgen_id: 'lead-1',
                  form_id: 'form-1',
                  ad_id: 'ad-1',
                },
              },
            ],
          },
        ],
      })
    ).toEqual([
      {
        leadgenId: 'lead-1',
        pageId: 'page-1',
        formId: 'form-1',
        adId: 'ad-1',
        createdTime: null,
      },
    ]);
  });

  it('normalizes standard Instant Form fields', () => {
    expect(
      normalizeMetaLead({
        id: 'lead-1',
        field_data: [
          { name: 'full_name', values: ['Ada Lovelace'] },
          { name: 'phone_number', values: ['+919999999999'] },
          { name: 'email', values: ['ada@example.com'] },
          { name: 'city', values: ['Bengaluru'] },
        ],
      })
    ).toEqual({
      name: 'Ada Lovelace',
      phone: '+919999999999',
      email: 'ada@example.com',
      fields: {
        full_name: 'Ada Lovelace',
        phone_number: '+919999999999',
        email: 'ada@example.com',
        city: 'Bengaluru',
      },
    });
  });
});
