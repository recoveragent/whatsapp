import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuilderNode } from '../shared';
import { syncTemplateButtonConfig, configQuickReplyIdsKey } from '@/lib/flows/template-buttons';

const captured = vi.hoisted(() => ({ fields: [] as Array<Record<string, unknown>> }));
vi.mock('@/components/shared/send-template-fields', () => ({
  SendTemplateFields: (props: Record<string, unknown>) => { captured.fields.push(props); return null; },
}));
vi.mock('./fields', () => ({ NextNodeRow: () => null, TextRow: () => null }));
import { CollectPaymentFields } from './collect-payment-fields';

afterEach(() => { vi.unstubAllGlobals(); captured.fields = []; });

describe('payment template picker state', () => {
  it('shows checkout-total and UPI controls without a fixed amount for recovery payments', () => {
    vi.stubGlobal('React', React);
    const config = { provider: 'razorpay', shopify_checkout_recovery: true, razorpay_checkout: 'upi', max_reminders: 0 };
    const html = renderToStaticMarkup(React.createElement(CollectPaymentFields, { node: { node_key: 'pay', node_type: 'collect_payment', config } as BuilderNode, allNodes: [], onChange: () => {}, triggerType: 'shopify_checkout_app_abandoned' }));
    expect(html).toContain('Collect the abandoned checkout total');
    expect(html).toContain('UPI payment link');
    expect(html).not.toContain('Fixed amount');
  });
  it('passes saved buttons back to both template editors so synchronization converges', () => {
    vi.stubGlobal('React', React);
    const buttons = [{ reply_id: 'old_reply', title: 'Continue', next_node_key: '' }];
    const config = { amount: 199, max_reminders: 2, request_template: { template_name: 'request', buttons }, reminder_template: { template_name: 'reminder', buttons } };
    renderToStaticMarkup(React.createElement(CollectPaymentFields, { node: { node_key: 'pay', node_type: 'collect_payment', config } as BuilderNode, allNodes: [], onChange: () => {} }));
    expect(captured.fields).toHaveLength(2);
    for (const props of captured.fields) {
      expect(props.buttons).toBe(buttons);
      expect(props.allowQuickReplies).toBe(false);
      const synced = syncTemplateButtonConfig(props.buttons as typeof buttons, { buttons: [{ type: 'QUICK_REPLY', text: 'Continue' }] });
      const saved = { ...props, buttons: synced };
      expect(configQuickReplyIdsKey(saved.buttons)).toBe(configQuickReplyIdsKey(syncTemplateButtonConfig(saved.buttons, { buttons: [{ type: 'QUICK_REPLY', text: 'Continue' }] })));
    }
  });
});
