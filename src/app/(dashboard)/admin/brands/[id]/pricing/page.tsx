'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { IndianRupee, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MESSAGE_PRICING_CATEGORIES,
  MESSAGE_PRICING_LABELS,
  type MessagePricingCategory,
} from '@/lib/wallet/types';
import { formatInrFromPaise, rupeesToPaise } from '@/lib/wallet/format';

export function BrandPricingPanel({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [balancePaise, setBalancePaise] = useState(0);
  const [prices, setPrices] = useState<Record<MessagePricingCategory, string>>({
    utility: '0.45',
    marketing: '0.78',
    authentication: '0.45',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}/pricing`);
      if (!res.ok) throw new Error('Failed to load pricing');
      const data = await res.json();
      setBrandName(data.brand?.name ?? '');
      setBalancePaise(Number(data.balancePaise ?? 0));
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
      const pricing = MESSAGE_PRICING_CATEGORIES.map((category) => ({
        category,
        pricePaise: rupeesToPaise(prices[category]),
      }));
      const res = await fetch(`/api/admin/brands/${brandId}/pricing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pricing }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      toast.success('Message pricing saved');
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{brandName}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set per-message rates (Meta guideline categories). Current wallet balance:{' '}
          <strong>{formatInrFromPaise(balancePaise)}</strong>
        </p>
      </div>

      <Card className="max-w-lg border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IndianRupee className="size-4" />
            Message pricing (per send)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
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
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save pricing'}
            </Button>
          </form>
        </CardContent>
      </Card>
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
        Configure Meta message debit rates for this brand.
      </p>
      <div className="mt-6">
        <BrandPricingPanel brandId={brandId} />
      </div>
    </div>
  );
}
