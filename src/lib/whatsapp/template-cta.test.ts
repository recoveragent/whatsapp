import { describe, expect, it } from 'vitest';
import {
  suggestedCta,
  seedCtaMappings,
  preserveCtaPurposes,
  buttonCtaPurpose,
} from './template-cta';
import { buildMetaTemplatePayload } from './template-components';
import { validateButtons } from './template-validators';
import { normalizeTemplateButtons } from '@/lib/flows/template-buttons';
import type { TemplateButton } from '@/types';

describe('purpose-based CTA suggestions', () => {
  it('suggests valid dynamic buttons for four distinct destinations', () => {
    const expected = {
      payment: ['Pay now', 'https://rzp.io/{{1}}'],
      tracking: ['Track order', 'https://crm.example.com/t/{{1}}'],
      checkout: ['Complete purchase', 'https://store.example.com/{{1}}'],
      order_status: ['View order', 'https://store.example.com/{{1}}'],
    } as const;
    for (const purpose of [
      'payment',
      'tracking',
      'checkout',
      'order_status',
    ] as const) {
      const button = suggestedCta(
        purpose,
        'https://crm.example.com',
        'https://store.example.com'
      );
      expect([button.text, button.url]).toEqual([...expected[purpose]]);
      expect(buttonCtaPurpose(button)).toBe(purpose);
      expect(() => validateButtons([button])).not.toThrow();
    }
  });
  it('requires a real HTTPS origin for store links and does not embed real order data', () => {
    for (const invalid of [
      '',
      'not-a-url',
      'http://shop.example.com',
      'https://user:secret@shop.example.com',
    ]) {
      expect(() =>
        suggestedCta('checkout', 'https://crm.example.com', invalid)
      ).toThrow();
    }
    expect(
      suggestedCta('checkout', '', 'https://store.example.com/customer-secret')
        .example
    ).toBe('https://store.example.com/checkouts/example-checkout');
  });
  it('maps each button by purpose and actual position, preserving user overrides', () => {
    const buttons: TemplateButton[] = [
      { type: 'QUICK_REPLY', text: 'Help' },
      suggestedCta('payment', ''),
      suggestedCta('tracking', 'https://crm.example.com'),
      suggestedCta('checkout', '', 'https://store.example.com'),
      suggestedCta('order_status', '', 'https://store.example.com'),
    ];
    expect(
      seedCtaMappings(buttons, {
        '1': '{{ vars.name }}',
        button_2: '{{ vars.my_tracking }}',
      })
    ).toEqual({
      '1': '{{ vars.name }}',
      button_1: '{{ vars.payment_url_suffix }}',
      button_2: '{{ vars.my_tracking }}',
      button_3: '{{ vars.checkout_url_suffix }}',
      button_4: '{{ vars.order_status_url_suffix }}',
    });
  });
  it('does not guess custom store URLs or map static links', () => {
    expect(
      seedCtaMappings(
        [
          { type: 'URL', text: 'Open', url: 'https://shop.example.com/{{1}}' },
          {
            type: 'URL',
            text: 'Pay',
            url: 'https://rzp.io/fixed',
            url_purpose: 'payment',
          },
        ],
        {}
      )
    ).toEqual({});
    expect(
      seedCtaMappings(
        [{ type: 'URL', text: 'Pay', url: 'https://rzp.io/{{1}}' }],
        {}
      )
    ).toEqual({ button_0: '{{ vars.payment_url_suffix }}' });
  });
  it('retains purpose during normalization and Meta sync only when URLs and labels match', () => {
    const button = suggestedCta('checkout', '', 'https://store.example.com');
    expect(normalizeTemplateButtons([button])[0]).toEqual(button);
    const metaButton = {
      type: button.type,
      text: button.text,
      url: button.url,
      example: button.example,
    };
    expect(preserveCtaPurposes([metaButton], [button])[0]).toEqual(button);
    expect(
      preserveCtaPurposes(
        [{ ...metaButton, url: 'https://other.example.com/{{1}}' }],
        [button]
      )[0]
    ).not.toHaveProperty('url_purpose');
    expect(
      preserveCtaPurposes([{ ...metaButton, text: 'Other' }], [button])[0]
    ).not.toHaveProperty('url_purpose');
  });
  it('never sends local purpose metadata to Meta', () => {
    const payload = buildMetaTemplatePayload({
      name: 'payment_advance',
      category: 'Utility',
      language: 'en_US',
      body_text: 'Please pay the advance.',
      buttons: [suggestedCta('payment', '')],
    });
    const button = payload.components.find((c) => c.type === 'BUTTONS')
      ?.buttons?.[0];
    expect(button?.url).toBe('https://rzp.io/{{1}}');
    expect(button).not.toHaveProperty('url_purpose');
  });
});
