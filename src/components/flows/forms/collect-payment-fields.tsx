'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SendTemplateFields } from '@/components/shared/send-template-fields';
import {
  PAYMENT_BRANCHES,
  PAYMENT_VARIABLE_GROUP,
  type CollectPaymentNodeConfig,
} from '@/lib/flows/payment-config';
import { templateVariableGroupsForFlow } from '@/lib/flows/template-variables';
import type { BuilderNode } from '../shared';
import { NextNodeRow, TextRow } from './fields';

function RazorpayConnection() {
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
    fetch('/api/payments/razorpay')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.error || 'Could not load Razorpay connection.');
        if (mounted) {
          setConnection(data);
          setKeyId(data.keyId);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function connect() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/payments/razorpay', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId, keySecret, webhookSecret }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || 'Could not connect Razorpay.');
      setConnection((previous) =>
        previous ? { ...previous, connected: true, keyId } : previous
      );
      setKeySecret('');
      setWebhookSecret('');
      toast.success('Razorpay connected for this brand.');
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
        Razorpay{' '}
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
              : 'Connect your Razorpay account'}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-muted-foreground text-xs">
              An admin can connect this brand using API keys from Razorpay →
              Account & settings → API keys. Collections settle to this Razorpay
              account.
            </p>
            <label className="block text-xs">
              Key ID
              <Input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
                autoComplete="off"
                placeholder="rzp_live_…"
              />
            </label>
            <label className="block text-xs">
              Key Secret
              <Input
                type="password"
                value={keySecret}
                onChange={(e) => setKeySecret(e.target.value)}
                autoComplete="new-password"
              />
            </label>
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
            <p className="text-muted-foreground text-xs">
              Add this URL in Razorpay Webhooks with the same webhook secret.
              Subscribe to payment_link.paid, payment_link.expired and
              payment_link.cancelled.
            </p>
            <p className="bg-muted rounded p-2 text-xs break-all select-all">
              {connection.webhookUrl}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={
                busy || !keyId || !keySecret || webhookSecret.length < 16
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
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const c = node.config as unknown as CollectPaymentNodeConfig;
  const groups = [
    ...templateVariableGroupsForFlow().filter((g) => g.id !== 'payment'),
    PAYMENT_VARIABLE_GROUP,
  ];
  return (
    <div className="space-y-5">
      <RazorpayConnection />
      <p className="text-muted-foreground text-xs">
        Create a unique payment link for each customer. The flow waits here
        until payment or expiry. A failed payment attempt can be retried; the
        Failed branch handles collection setup errors or a cancelled link.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          Gateway
          <Input value="Razorpay" readOnly />
        </label>
        <label className="text-xs">
          Currency
          <Input value="INR (₹)" readOnly />
        </label>
      </div>
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
          payment link into its body or URL button.
        </p>
        <SendTemplateFields
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
