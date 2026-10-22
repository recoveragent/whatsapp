'use client';

import { PaymentConfigPanel } from '@/components/admin/payment-config-panel';
import { PageHeader } from '@/components/layout/page-header';

export default function AdminBillingPage() {
  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Admin"
        title="Payment gateway"
        subtitle="Configure Razorpay for Recover Agent. Brands recharge their wallets through this gateway with GST applied automatically."
      />
      <div className="mt-6">
        <PaymentConfigPanel />
      </div>
    </div>
  );
}
