'use client';

import { PaymentConfigPanel } from '@/components/admin/payment-config-panel';

export default function AdminBillingPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Payment gateway
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure Razorpay for Recover Agent. Brands recharge their wallets
        through this gateway with GST applied automatically.
      </p>
      <div className="mt-6">
        <PaymentConfigPanel />
      </div>
    </div>
  );
}
