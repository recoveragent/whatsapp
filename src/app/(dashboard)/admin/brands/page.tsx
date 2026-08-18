'use client';

import { BrandsAdminPanel } from '@/components/admin/brands-admin-panel';
import { PageHeader } from '@/components/layout/page-header';

export default function AdminBrandsPage() {
  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Admin"
        title="Recover Agent"
        subtitle="Manage brands under your company. Each brand has its own contacts, inbox, and WhatsApp configuration."
      />
      <div className="mt-6">
        <BrandsAdminPanel />
      </div>
    </div>
  );
}
