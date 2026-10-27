import { describe, expect, it } from 'vitest';
import { CHECKOUT_RECOVERY_SNAPSHOT } from './checkout-recovery-preset';
import {
  listBuiltinAdminFlowPresets,
  getBuiltinAdminFlowPresetSnapshot,
} from './admin-flow-presets';
import { validateFlowForActivation } from './validate';
import { deriveCanvasEdges, outgoingSlots, applyEdgeConnection } from './edges';
import type { BuilderNode } from '@/components/flows/shared';
import { cloneTriggerConfigForCopy } from './clone-flow-snapshot';
import { getAdminTemplatePreset } from '@/lib/whatsapp/admin-template-presets';
import { buttonCtaPurpose } from '@/lib/whatsapp/template-cta';
import { paymentTemplateError } from '@/lib/payments/template-compatibility';

describe('global checkout recovery flow', () => {
  it('is available for Super Admin multi-brand copying', () => {
    expect(
      listBuiltinAdminFlowPresets().some(
        (p) => p.slug === 'checkout_payment_recovery'
      )
    ).toBe(true);
    expect(getBuiltinAdminFlowPresetSnapshot('checkout_payment_recovery')).toBe(
      CHECKOUT_RECOVERY_SNAPSHOT
    );
  });
  it('has a valid graph with separate COD confirmation and paid order receipt', () => {
    const snapshot = {
      ...CHECKOUT_RECOVERY_SNAPSHOT,
      exit_config: null,
      trigger_config: cloneTriggerConfigForCopy(
        CHECKOUT_RECOVERY_SNAPSHOT.trigger_type,
        CHECKOUT_RECOVERY_SNAPSHOT.trigger_config
      ),
    };
    // Each brand must upload its own header image fallback before activation.
    expect(
      validateFlowForActivation(snapshot, snapshot.nodes).filter(
        (i) => i.severity === 'error'
      )
    ).toMatchObject([
      { node_key: 'recovery_message', field: 'variables.header_media' },
    ]);
    const configured = structuredClone(snapshot);
    const message = configured.nodes.find(
      (n) => n.node_key === 'recovery_message'
    )!.config as { variables: Record<string, string> };
    message.variables.header_media =
      '{{ vars.product_image | "https://cdn.example.com/brand.jpg" }}';
    expect(
      validateFlowForActivation(configured, configured.nodes).filter(
        (i) => i.severity === 'error'
      )
    ).toEqual([]);
    message.variables.header_media =
      '{{ vars.product_image | "Product image unavailable" }}';
    expect(
      validateFlowForActivation(configured, configured.nodes).filter(
        (i) => i.severity === 'error'
      )
    ).toMatchObject([
      { message: 'Upload an image to send when this variable is empty.' },
    ]);
    const payment = snapshot.nodes.find(
      (n) => n.node_key === 'collect_checkout_payment'
    )!;
    expect(payment.config).toMatchObject({
      shopify_checkout_recovery: true,
      paid_next: 'paid_receipt',
    });
    expect(
      snapshot.nodes.find((n) => n.node_key === 'confirm_cod')?.config.text
    ).toContain('checkout_order_summary');
  });
  it('sends the payment link on a Razorpay Pay now button, not in the body', () => {
    const template = getAdminTemplatePreset('recovery_payment_request')!;
    expect(template.body_text).not.toMatch(/\{\{3\}\}|https?:/);
    expect(template.buttons).toMatchObject([
      { type: 'URL', text: 'Pay now', url: 'https://rzp.io/{{1}}' },
    ]);
    expect(buttonCtaPurpose(template.buttons[0])).toBe('payment');
    const payment = CHECKOUT_RECOVERY_SNAPSHOT.nodes.find(
      (n) => n.node_key === 'collect_checkout_payment'
    )!.config as Record<string, { variables: Record<string, string> }>;
    for (const key of ['request_template', 'reminder_template']) {
      const variables = payment[key].variables;
      expect(Object.keys(variables)).toEqual(['1', '2', 'button_0']);
      expect(variables.button_0).toContain('vars.payment_url_suffix');
      expect(
        paymentTemplateError(template.buttons, variables, ['https://rzp.io'])
      ).toBeNull();
    }
  });
  it('rejects a path that skips the COD confirmation summary', () => {
    const s = structuredClone(CHECKOUT_RECOVERY_SNAPSHOT);
    s.nodes.find((n) => n.node_key === 'start')!.config.next_node_key =
      'place_cod';
    expect(
      validateFlowForActivation({ ...s, exit_config: null }, s.nodes).some(
        (i) => i.severity === 'error' && i.node_key === 'place_cod'
      )
    ).toBe(true);
  });
  it('renders and reconnects all recovery branches', () => {
    const nodes = CHECKOUT_RECOVERY_SNAPSHOT.nodes as BuilderNode[];
    const review = nodes.find((n) => n.node_key === 'review_cod')!;
    expect(outgoingSlots(review)).toHaveLength(3);
    expect(
      deriveCanvasEdges(nodes).filter((e) => e.source === review.node_key)
    ).toHaveLength(3);
    expect(applyEdgeConnection(review, 'checkout', 'end')).toEqual({
      checkout_next: 'end',
    });
  });
});
