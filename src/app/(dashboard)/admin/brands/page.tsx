'use client';

import { BrandsAdminPanel } from '@/components/admin/brands-admin-panel';

export default function AdminBrandsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Recover Agent
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage brands under your company. Each brand has its own contacts,
        inbox, and WhatsApp configuration.
      </p>
      <div className="mt-6">
        <BrandsAdminPanel />
      </div>
    </div>
  );
}
