'use client';
import type { BuilderNode } from '../shared';
import { CHECKOUT_RECOVERY_BRANCHES } from '@/lib/flows/checkout-recovery-config';
import { NextNodeRow } from './fields';

export function CheckoutRecoveryFields({
  node,
  allNodes,
  onChange,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const c = node.config;
  return (
    <div className="space-y-4">
      <label className="block text-xs">
        Action
        <select
          className="bg-background mt-1 w-full rounded border p-2"
          value={String(c.action ?? 'prepare_cod')}
          onChange={(e) => onChange({ action: e.target.value })}
        >
          <option value="prepare_cod">Review COD checkout</option>
          <option value="place_cod">Place confirmed COD order</option>
          <option value="prepare_prepaid">Check checkout for UPI payment</option>
        </select>
      </label>
      {(c.action ?? 'prepare_cod') === 'prepare_cod' && (
        <label className="block text-xs">
          When the customer selects Cash on Delivery
          <select
            className="bg-background mt-1 w-full rounded border p-2"
            value={String(c.cod_mode ?? 'checkout')}
            onChange={(e) => onChange({ cod_mode: e.target.value })}
          >
            <option value="checkout">
              Continue on the checkout partner’s page
            </option>
            <option value="create_order">
              Confirm in WhatsApp and create a Shopify order
            </option>
          </select>
        </label>
      )}
      {c.action === 'prepare_prepaid' && (
        <p className="text-muted-foreground text-xs">
          Quotes the checkout at its prepaid total before a Collect payment
          step. Connect Ready to Collect payment; unsupported checkouts follow
          Continue on checkout.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Automatic COD requires complete checkout data, an unchanged Shopify
        total, and a separate confirmation button. Show{' '}
        {'{{ vars.checkout_order_summary }}'} in the confirmation message.
        Quotes expire after 15 minutes. Unsupported checkouts follow Continue on
        checkout.
      </p>
      {CHECKOUT_RECOVERY_BRANCHES.map((branch) => (
        <NextNodeRow
          key={branch.id}
          label={branch.label}
          value={String(c[branch.field] ?? '')}
          currentKey={node.node_key}
          allNodes={allNodes}
          onChange={(value) => onChange({ [branch.field]: value })}
        />
      ))}
    </div>
  );
}
