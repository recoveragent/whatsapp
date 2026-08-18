'use client';

import { WalletPanel } from '@/components/wallet/wallet-panel';
import { PageHeader } from '@/components/layout/page-header';

export default function WalletPage() {
  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Billing"
        title="Wallet"
        subtitle="Manage your prepaid balance for WhatsApp messaging."
      />
      <div className="mt-6">
        <WalletPanel />
      </div>
    </div>
  );
}
