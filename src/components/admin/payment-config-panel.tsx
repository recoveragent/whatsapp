'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

interface PaymentConfig {
  provider: string;
  keyId: string;
  gstRate: number;
  isEnabled: boolean;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
}

export function PaymentConfigPanel() {
  const { isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [gstRate, setGstRate] = useState('18');
  const [isEnabled, setIsEnabled] = useState(false);
  const [hasKeySecret, setHasKeySecret] = useState(false);
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-config');
      if (!res.ok) throw new Error('Failed to load payment config');
      const data = await res.json();
      const config = data.config as PaymentConfig | null;
      setWebhookUrl(data.webhookUrl ?? '');
      if (config) {
        setKeyId(config.keyId ?? '');
        setGstRate(String(Math.round((config.gstRate ?? 0.18) * 100)));
        setIsEnabled(config.isEnabled);
        setHasKeySecret(config.hasKeySecret);
        setHasWebhookSecret(config.hasWebhookSecret);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) void load();
  }, [isSuperAdmin, load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/payment-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyId,
          keySecret: keySecret || undefined,
          webhookSecret: webhookSecret || undefined,
          gstRate: Number(gstRate) / 100,
          isEnabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      toast.success('Payment gateway saved');
      setKeySecret('');
      setWebhookSecret('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperAdmin) {
    return (
      <p className="text-sm text-muted-foreground">Super admin access required.</p>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="max-w-xl border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4" />
          Razorpay payment gateway
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="keyId">Key ID</Label>
            <Input
              id="keyId"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_..."
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keySecret">
              Key secret {hasKeySecret ? '(saved — leave blank to keep)' : ''}
            </Label>
            <Input
              id="keySecret"
              type="password"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
              placeholder={hasKeySecret ? '••••••••' : 'Enter key secret'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhookSecret">
              Webhook secret {hasWebhookSecret ? '(saved — leave blank to keep)' : ''}
            </Label>
            <Input
              id="webhookSecret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={hasWebhookSecret ? '••••••••' : 'Optional'}
            />
          </div>
          {webhookUrl ? (
            <p className="text-xs text-muted-foreground break-all">
              Webhook URL: <code>{webhookUrl}</code>
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="gstRate">GST rate (%)</Label>
            <Input
              id="gstRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="rounded border-border"
            />
            Enable brand recharges
          </label>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save gateway'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
