'use client';

import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SendTemplateFields } from '@/components/shared/send-template-fields';
import {
  DEFAULT_SHOPIFY_PAID_TAG,
  PAYMENT_BRANCHES,
  PAYMENT_VARIABLE_GROUP,
  supportsCodToPrepaid,
  type CollectPaymentNodeConfig,
} from '@/lib/flows/payment-config';
import { templateVariableGroupsForFlow } from '@/lib/flows/template-variables';
import type { FlowTriggerType } from '@/lib/flows/trigger-types';
import type { BuilderNode } from '../shared';
import { NextNodeRow, TextRow } from './fields';

function PaymentConnection({
  provider,
}: {
  provider: 'razorpay' | 'cashfree';
}) {
  const cashfree = provider === 'cashfree';
  const label = cashfree ? 'Cashfree' : 'Razorpay';
  const [environment, setEnvironment] = useState('production');
  const [connection, setConnection] = useState<{
    connected: boolean;
    keyId: string;
    webhookUrl: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  useEffect(() => {
    let mounted = true;
    fetch(`/api/payments/${provider}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || 'Could not load Razorpay connection.');
        if (mounted) {
          setConnection(data);
          setKeyId(data.keyId);
          setEnvironment(data.environment ?? 'production');
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      });
    return () => {
      mounted = false;
    };
  }, [provider]);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/payments/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, keySecret, webhookSecret, environment }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not connect Razorpay.');
      setConnection((previous) =>
        previous ? { ...previous, connected: true, keyId } : previous
      );
      setKeySecret('');
      setWebhookSecret('');
      toast.success(`${label} connected for this brand.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CreditCard className="size-4" />
        {label}{' '}
        <span className="text-muted-foreground ml-auto text-xs">
          {connection
            ? connection.connected
              ? 'Connected'
              : 'Not connected'
            : error
              ? 'Unavailable'
              : 'Loading…'}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      {connection && (
        <details open={!connection.connected}>
          <summary className="text-primary cursor-pointer text-xs">
            {connection.connected
              ? 'Manage connection'
              : `Connect your ${label} account`}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-muted-foreground text-xs">
              An admin can connect this brand using API keys from the {label}{' '}
              dashboard. Collections settle to this {label} account.
            </p>
            <label className="block text-xs">
              {cashfree ? 'App ID' : 'Key ID'}
              <Input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                autoComplete="off"
                placeholder={cashfree ? 'Cashfree App ID' : 'rzp_live_…'}
              />
            </label>
            <label className="block text-xs">
              {cashfree ? 'Secret Key' : 'Key Secret'}
              <Input
                type="password"
                value={keySecret}
                onChange={(e) => setKeySecret(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {cashfree && (
              <label className="block text-xs">
                Environment
                <select
                  className="bg-background mt-1 w-full rounded border p-2"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                >
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox (test payments)</option>
                </select>
              </label>
            )}
            {!cashfree && (
              <label className="block text-xs">
                Webhook secret
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 16 characters"
                />
              </label>
            )}
            <p className="text-muted-foreground text-xs">
              {cashfree
                ? 'Add this URL in Cashfree Webhooks for Payment Link events (PAYMENT_LINK_EVENT). Signatures use your Cashfree Secret Key; no extra webhook secret is needed.'
                : 'Add this URL in Razorpay Webhooks with the same webhook secret. Subscribe to payment_link.paid, payment_link.expired and payment_link.cancelled.'}
            </p>
            <p className="bg-muted rounded p-2 text-xs break-all select-all">
              {connection.webhookUrl}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={
                busy ||
                !keyId ||
                !keySecret ||
                (!cashfree && webhookSecret.length < 16)
              }
              onClick={() => void connect()}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}Verify and
              connect
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}

export function CollectPaymentFields({
  node,
  allNodes,
  onChange,
  triggerType,
  triggerConfig,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onChange: (patch: Record<string, unknown>) => void;
  triggerType?: FlowTriggerType;
  triggerConfig?: Record<string, unknown>;
}) {
  const c = node.config as unknown as CollectPaymentNodeConfig;
  const cod = c.shopify_cod_to_prepaid === true;
  const groups = useMemo(
    () => [
      ...templateVariableGroupsForFlow(triggerType, triggerConfig).filter(
        (g) => g.id !== 'payment'
      ),
      PAYMENT_VARIABLE_GROUP,
    ],
    [triggerType, triggerConfig]
  );
  return (
    <div className="space-y-5">
      <PaymentConnection
        key={c.provider}
        provider={c.provider === 'cashfree' ? 'cashfree' : 'razorpay'}
      />
      <p className="text-muted-foreground text-xs">
        Create a unique payment link for each customer. The flow waits here
        until payment or expiry. A failed payment attempt can be retried; the
        Failed branch handles collection setup errors or a cancelled link.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          Gateway
          <select
            className="bg-background mt-1 w-full rounded border p-2"
            value={c.provider ?? 'razorpay'}
            onChange={(e) => onChange({ provider: e.target.value })}
          >
            <option value="razorpay">Razorpay</option>
            <option value="cashfree">Cashfree</option>
          </select>
        </label>
        <label className="text-xs">
          Currency
          <Input value="INR (₹)" readOnly />
        </label>
      </div>
      {c.provider === 'cashfree' && (
        <section className="space-y-2">
          <label className="block text-xs">
            Checkout experience
            <select
              className="bg-background mt-1 w-full rounded border p-2"
              value={c.cashfree_checkout ?? 'upi_intent'}
              onChange={(e) => onChange({ cashfree_checkout: e.target.value })}
            >
              <option value="upi_intent">Direct UPI app (fewer steps)</option>
              <option value="hosted">Hosted checkout page</option>
            </select>
          </label>
          <p className="text-muted-foreground text-xs">
            Direct UPI requests a handoff to a UPI app on supported phones.
            Other devices use Cashfree checkout. Applies to newly generated
            links.
          </p>
          <p className="text-muted-foreground text-xs">
            WhatsApp’s native payment sheet requires separate Cashfree merchant
            activation and integration; selecting Direct UPI enables the app
            handoff.
          </p>
        </section>
      )}
      {(cod || supportsCodToPrepaid(triggerType)) && (
        <section className="space-y-2 rounded-lg border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={cod}
              onChange={(e) =>
                onChange({
                  shopify_cod_to_prepaid: e.target.checked,
                  ...(e.target.checked && c.shopify_paid_tag === undefined
                    ? { shopify_paid_tag: DEFAULT_SHOPIFY_PAID_TAG }
                    : {}),
                })
              }
            />
            COD to prepaid: collect the Shopify order amount
          </label>
          <p className="text-muted-foreground text-xs">
            Charges the order’s outstanding balance. When payment is verified,
            the Shopify order is marked as paid and tagged. Cancelled or
            already-paid orders follow the Failed branch without a link.
          </p>
          {cod && !supportsCodToPrepaid(triggerType) && (
            <p role="alert" className="text-destructive text-xs">
              Use the “Shopify: order placed” or “Shopify: order updated”
              trigger for COD to prepaid.
            </p>
          )}
          {cod && (
            <TextRow
              label="Tag added to the paid order (optional)"
              value={c.shopify_paid_tag ?? ''}
              onChange={(shopify_paid_tag) => onChange({ shopify_paid_tag })}
            />
          )}
        </section>
      )}
      {!cod && (
        <label className="block text-xs">
          Fixed amount (₹)
          <Input
            type="number"
            min={1}
            step="0.01"
            value={c.amount ?? ''}
            onChange={(e) =>
              onChange({
                amount: e.target.value === '' ? 0 : Number(e.target.value),
              })
            }
          />
        </label>
      )}
      <TextRow
        label="Payment description"
        value={c.description ?? ''}
        onChange={(description) => onChange({ description })}
      />
      <label className="block text-xs">
        Link expires after (hours)
        <Input
          type="number"
          min={1}
          max={720}
          value={c.expiry_hours ?? 24}
          onChange={(e) => onChange({ expiry_hours: Number(e.target.value) })}
        />
      </label>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">Payment request message</h3>
        <p className="text-muted-foreground text-xs">
          Select an approved template without quick-reply buttons. Map the
          payment link into its body or URL button. The button domain must match
          the selected gateway (Cashfree production: payments.cashfree.com;
          sandbox: payments-test.cashfree.com).
        </p>
        <SendTemplateFields
          allowQuickReplies={false}
          creationPurpose="payment"
          paymentProvider={c.provider}
          buttons={c.request_template?.buttons}
          templateName={c.request_template?.template_name ?? ''}
          language={c.request_template?.language ?? 'en_US'}
          variables={c.request_template?.variables ?? {}}
          variableGroups={groups}
          onChange={(patch) =>
            onChange({
              request_template: {
                ...c.request_template,
                ...patch,
                next_node_key: '',
              },
            })
          }
        />
      </section>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">Unpaid reminders</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            Interval (minutes)
            <Input
              type="number"
              min={5}
              value={c.reminder_minutes ?? 60}
              onChange={(e) =>
                onChange({ reminder_minutes: Number(e.target.value) })
              }
            />
          </label>
          <label className="text-xs">
            Maximum reminders
            <Input
              type="number"
              min={0}
              max={5}
              value={c.max_reminders ?? 2}
              onChange={(e) =>
                onChange({ max_reminders: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <p className="text-muted-foreground text-xs">
          Reminders stop when payment is verified or the link expires. Set 0 to
          disable. Scheduled checks run at the configured flows cron interval.
        </p>
        {c.max_reminders > 0 && (
          <SendTemplateFields
            allowQuickReplies={false}
            creationPurpose="payment"
            paymentProvider={c.provider}
            buttons={c.reminder_template?.buttons}
            templateName={c.reminder_template?.template_name ?? ''}
            language={c.reminder_template?.language ?? 'en_US'}
            variables={c.reminder_template?.variables ?? {}}
            variableGroups={groups}
            onChange={(patch) =>
              onChange({
                reminder_template: {
                  ...c.reminder_template,
                  ...patch,
                  next_node_key: '',
                },
              })
            }
          />
        )}
      </section>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">After collection</h3>
        <p className="text-muted-foreground text-xs">
          Connect Payment received to a Send template step for your receipt.
          Connect Expired and Failed to the appropriate follow-up.
        </p>
        {PAYMENT_BRANCHES.map((branch) => (
          <NextNodeRow
            key={branch.id}
            label={branch.label}
            value={c[branch.field] ?? ''}
            allNodes={allNodes}
            currentKey={node.node_key}
            onChange={(value) => onChange({ [branch.field]: value })}
          />
        ))}
      </section>
    </div>
  );
}
