import { describe, expect, it } from 'vitest';
import { paymentOrigins, paymentTemplateError } from './template-compatibility';

describe('payment template gateway compatibility', () => {
  const vars = { button_0: '{{ vars.payment_url_suffix }}' };
  it('rejects a Razorpay button in a Cashfree flow even without purpose metadata', () => {
    expect(
      paymentTemplateError(
        [
          {
            type: 'URL',
            text: 'Pay now',
            url: 'https://rzp.io/{{1}}',
            url_purpose: 'custom',
          },
        ],
        vars,
        paymentOrigins('cashfree', 'production')
      )
    ).toContain('payments.cashfree.com');
  });
  it('accepts the correct Cashfree button and keeps sandbox separate', () => {
    const buttons = [
      {
        type: 'URL',
        text: 'Pay now',
        url: 'https://payments.cashfree.com/{{1}}',
      },
    ];
    expect(
      paymentTemplateError(
        buttons,
        vars,
        paymentOrigins('cashfree', 'production')
      )
    ).toBeNull();
    expect(
      paymentTemplateError(buttons, vars, paymentOrigins('cashfree', 'sandbox'))
    ).toContain('payments-test.cashfree.com');
  });
  it('allows a payment URL in the message body and unrelated tracking buttons', () => {
    expect(
      paymentTemplateError(
        [],
        { '1': '{{ vars.payment_url }}' },
        paymentOrigins('cashfree')
      )
    ).toBeNull();
    expect(
      paymentTemplateError(
        [{ type: 'URL', text: 'Track', url: 'https://courier.test/{{1}}' }],
        { button_0: '{{ vars.tracking_url_suffix }}' },
        paymentOrigins('cashfree')
      )
    ).toBeNull();
  });
  it('rejects a hardcoded link or an extra path that would duplicate the full payment suffix', () => {
    for (const url of [
      'https://payments.cashfree.com/links/fixed',
      'https://payments.cashfree.com/links/{{1}}',
    ])
      expect(
        paymentTemplateError(
          [{ type: 'URL', text: 'Pay', url }],
          vars,
          paymentOrigins('cashfree', 'production')
        )
      ).not.toBeNull();
  });
});
