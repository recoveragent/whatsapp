import { describe, expect, it } from 'vitest';
import {
  paymentConfigErrors,
  PAYMENT_BRANCHES,
  supportsCodToPrepaid,
} from './payment-config';
import {
  applyEdgeConnection,
  deriveCanvasEdges,
  outgoingSlots,
  renameNodeReferences,
  unlinkNodeReferences,
} from './edges';
import { validateFlowForActivation } from './validate';
import type { BuilderNode } from '@/components/flows/shared';

const template = {
  template_name: 'collect_advance',
  language: 'en_US',
  variables: { '1': '{{ vars.payment_url }}' },
  next_node_key: '',
};
const config = {
  provider: 'razorpay',
  currency: 'INR',
  amount: 199.99,
  description: 'Advance',
  expiry_hours: 24,
  reminder_minutes: 60,
  max_reminders: 2,
  request_template: template,
  reminder_template: template,
  paid_next: 'paid',
  expired_next: 'expired',
  failed_next: 'failed',
};
const node: BuilderNode = {
  node_key: 'collect',
  node_type: 'collect_payment',
  config,
};
const targets: BuilderNode[] = PAYMENT_BRANCHES.map((b) => ({
  node_key: b.id,
  node_type: 'end',
  config: {},
}));

describe('collect payment flow configuration', () => {
  it('validates the optional Cashfree checkout choice', () => {
    for (const cashfree_checkout of ['upi_intent', 'hosted']) expect(paymentConfigErrors({ ...config, provider: 'cashfree', cashfree_checkout })).toEqual([]);
    expect(paymentConfigErrors({ ...config, provider: 'cashfree', cashfree_checkout: 'native' }).some(e => e.field === 'cashfree_checkout')).toBe(true);
  });

  it('accepts Cashfree with the same flow settings', () => expect(paymentConfigErrors({ ...config, provider: 'cashfree' })).toEqual([]));
  it('accepts a fixed deposit with approved-template mappings and bounded reminders', () =>
    expect(paymentConfigErrors(config)).toEqual([]));
  it('rejects unsafe amounts and reminder settings', () => {
    for (const amount of [0, -1, 1.001, NaN, Infinity, '199'])
      expect(
        paymentConfigErrors({ ...config, amount }).some(
          (e) => e.field === 'amount'
        )
      ).toBe(true);
    for (const patch of [
      { max_reminders: 6 },
      { max_reminders: -1 },
      { reminder_minutes: 0 },
      { reminder_minutes: 1440 },
      { expiry_hours: Infinity },
    ])
      expect(
        paymentConfigErrors({ ...config, ...patch }).length
      ).toBeGreaterThan(0);
  });
  it('requires link mappings, forbids quick-reply templates, and supports disabling reminders', () => {
    expect(
      paymentConfigErrors({
        ...config,
        request_template: { ...template, variables: {} },
      }).length
    ).toBeGreaterThan(0);
    expect(
      paymentConfigErrors({
        ...config,
        request_template: { ...template, buttons: [{}] },
      }).length
    ).toBeGreaterThan(0);
    expect(
      paymentConfigErrors({
        ...config,
        max_reminders: 0,
        reminder_template: undefined,
      })
    ).toEqual([]);
  });
  it('wires, renames and removes all payment branches without changing template contents', () => {
    expect(outgoingSlots(node).map((s) => s.id)).toEqual([
      'paid',
      'expired',
      'failed',
    ]);
    expect(deriveCanvasEdges([node, ...targets]).map((e) => e.target)).toEqual([
      'paid',
      'expired',
      'failed',
    ]);
    expect(applyEdgeConnection(node, 'paid', 'receipt')).toEqual({
      paid_next: 'receipt',
    });
    expect(
      renameNodeReferences([node], 'paid', 'receipt')[0].config.paid_next
    ).toBe('receipt');
    expect(unlinkNodeReferences([node], 'expired')[0].config.expired_next).toBe(
      ''
    );
  });
  it('validates branch reachability and refuses a missing receipt path', () => {
    const flow = {
      name: 'Advance',
      trigger_type: 'manual' as const,
      trigger_config: {},
      entry_node_id: 'collect',
    };
    expect(
      validateFlowForActivation(flow, [node, ...targets]).filter(
        (i) => i.severity === 'error'
      )
    ).toEqual([]);
    expect(
      validateFlowForActivation(flow, [
        { ...node, config: { ...config, paid_next: '' } },
        ...targets,
      ]).some((i) => i.field === 'paid_next')
    ).toBe(true);
  });
});

describe('COD to prepaid configuration', () => {
  it('takes the amount from the Shopify order instead of a fixed amount', () => {
    expect(
      paymentConfigErrors({ ...config, amount: 0, shopify_cod_to_prepaid: true })
    ).toEqual([]);
    expect(paymentConfigErrors({ ...config, amount: 0 })).toContainEqual(
      expect.objectContaining({ field: 'amount' })
    );
  });
  it('accepts one Shopify tag', () => {
    expect(
      paymentConfigErrors({ ...config, shopify_paid_tag: 'a,b' })
    ).toContainEqual(expect.objectContaining({ field: 'shopify_paid_tag' }));
  });
  it('is offered only for order placed and order updated triggers', () => {
    expect(supportsCodToPrepaid('shopify_order_placed')).toBe(true);
    expect(supportsCodToPrepaid('shopify_order_updated')).toBe(true);
    expect(supportsCodToPrepaid('shopify_order_cancelled')).toBe(false);
    expect(supportsCodToPrepaid(undefined)).toBe(false);
  });
});
