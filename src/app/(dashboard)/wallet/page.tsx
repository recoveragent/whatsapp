'use client';

import { WalletPanel } from '@/components/wallet/wallet-panel';

export default function WalletPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Wallet</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your prepaid balance for WhatsApp messaging.
      </p>
      <div className="mt-6">
        <WalletPanel />
      </div>
    </div>
  );
}
