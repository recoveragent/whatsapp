'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { computeGstPaise, formatInrFromPaise, rupeesToPaise } from '@/lib/wallet/format';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

interface RechargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gstRate: number;
  onSuccess: () => void;
}

export function RechargeDialog({
  open,
  onOpenChange,
  gstRate,
  onSuccess,
}: RechargeDialogProps) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (window.Razorpay) {
      setScriptReady(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () => toast.error('Failed to load payment gateway');
    document.body.appendChild(script);
  }, [open]);

  const basePaise = useMemo(() => rupeesToPaise(amount), [amount]);
  const gstPaise = useMemo(() => computeGstPaise(basePaise, gstRate), [basePaise, gstRate]);
  const totalPaise = basePaise + gstPaise;

  const handleRecharge = async () => {
    if (basePaise < 100) {
      toast.error('Minimum recharge is ₹1.00');
      return;
    }
    if (!scriptReady || !window.Razorpay) {
      toast.error('Payment gateway not ready');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/wallet/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountPaise: basePaise }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to start recharge');

      const rechargeId = data.rechargeId as string;
      const orderId = data.orderId as string;
      const keyId = data.keyId as string;

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay!({
          key: keyId,
          amount: data.totalAmountPaise,
          currency: 'INR',
          name: 'Recover Agent',
          description: 'Wallet recharge',
          order_id: orderId,
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch('/api/wallet/recharge/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  rechargeId,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              const verifyData = await verifyRes.json().catch(() => ({}));
              if (!verifyRes.ok) {
                throw new Error(verifyData.error ?? 'Payment verification failed');
              }
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          modal: {
            ondismiss: () => reject(new Error('Payment cancelled')),
          },
        });
        rzp.open();
      });

      onSuccess();
      setAmount('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Recharge failed';
      if (msg !== 'Payment cancelled') toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recharge wallet</DialogTitle>
          <DialogDescription>
            Enter the recharge amount. GST ({Math.round(gstRate * 100)}%) is added to the total.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rechargeAmount">Recharge amount (₹)</Label>
            <Input
              id="rechargeAmount"
              type="number"
              min="1"
              step="0.01"
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {basePaise > 0 ? (
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatInrFromPaise(basePaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">GST ({Math.round(gstRate * 100)}%)</span>
                <span>{formatInrFromPaise(gstPaise)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span>Total payable</span>
                <span>{formatInrFromPaise(totalPaise)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleRecharge()} disabled={loading || basePaise < 100}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : 'Pay now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
