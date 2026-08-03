'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { IndianRupee, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  ACCOUNT_BILLING_MODE_LABELS,
  isAccountBillingMode,
  MESSAGE_PRICING_CATEGORIES,
  MESSAGE_PRICING_LABELS,
  type AccountBillingMode,
  type MessagePricingCategory,
} from '@/lib/wallet/types';
import { formatInrFromPaise, rupeesToPaise } from '@/lib/wallet/format';

export function BrandPricingPanel({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [balancePaise, setBalancePaise] = useState(0);
  const [billingMode, setBillingMode] = useState<AccountBillingMode>('wallet');
  const [prices, setPrices] = useState<Record<MessagePricingCategory, string>>({
    utility: '0',
    marketing: '0',
    authentication: '0',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}/pricing`);
      if (!res.ok) throw new Error('Failed to load pricing');
      const data = await res.json();
      setBrandName(data.brand?.name ?? '');
      setBalancePaise(Number(data.balancePaise ?? 0));
      setBillingMode(
        isAccountBillingMode(data.billingMode) ? data.billingMode : 'wallet',
      );
      const next: Record<MessagePricingCategory, string> = {
        utility: '0',
        marketing: '0',
        authentication: '0',
      };
      for (const row of data.pricing ?? []) {
        const cat = row.category as MessagePricingCategory;
        next[cat] = String((Number(row.pricePaise) / 100).toFixed(2));
      }
      setPrices(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pricing =
        billingMode === 'wallet'
          ? MESSAGE_PRICING_CATEGORIES.map((category) => ({
              category,
              pricePaise: rupeesToPaise(prices[category]),
            }))
          : undefined;
      const res = await fetch(`/api/admin/brands/${brandId}/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingMode, pricing }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      toast.success('Billing settings saved');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const walletEnabled = billingMode === 'wallet';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{brandName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how this brand pays for template sends.
          {walletEnabled ? (
            <>
              {' '}
              Current wallet balance: <strong>{formatInrFromPaise(balancePaise)}</strong>
            </>
          ) : null}
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card className="max-w-lg border-border">
          <CardHeader>
            <CardTitle className="text-base">Billing mode</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={billingMode}
              onValueChange={(value) => {
                if (isAccountBillingMode(value)) setBillingMode(value);
              }}
              className="gap-3"
            >
              {(['wallet', 'meta_direct'] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                    billingMode === mode ? 'border-primary' : 'border-border'
                  }`}
                >
                  <RadioGroupItem value={mode} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {ACCOUNT_BILLING_MODE_LABELS[mode]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {mode === 'wallet'
                        ? 'Templates debit the prepaid CRM wallet. Sends are blocked when balance is low.'
                        : 'Client pays Meta directly. Wallet balance checks and debits are disabled.'}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {walletEnabled ? (
          <Card className="max-w-lg border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IndianRupee className="size-4" />
                Message pricing (per send)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {MESSAGE_PRICING_CATEGORIES.map((category) => (
                <div key={category} className="space-y-2">
                  <Label htmlFor={`price-${category}`}>
                    {MESSAGE_PRICING_LABELS[category]} (₹)
                  </Label>
                  <Input
                    id={`price-${category}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={prices[category]}
                    onChange={(e) =>
                      setPrices((prev) => ({ ...prev, [category]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <p className="max-w-lg text-sm text-muted-foreground">
            Wallet pricing and recharge do not apply while Meta direct payment is selected.
          </p>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save billing settings'}
        </Button>
      </form>
    </div>
  );
}

export default function BrandPricingPage() {
  const params = useParams();
  const brandId = typeof params.id === 'string' ? params.id : '';

  if (!brandId) {
    return <p className="text-sm text-muted-foreground">Invalid brand.</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Wallet & pricing
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose wallet billing or Meta direct payment for this brand.
      </p>
      <div className="mt-6">
        <BrandPricingPanel brandId={brandId} />
      </div>
    </div>
  );
}
