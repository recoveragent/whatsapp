'use client';

import { AdminFlowPushPanel } from '@/components/admin/admin-flow-push-panel';
import { PageHeader } from '@/components/layout/page-header';

export default function AdminFlowsPage() {
  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Admin"
        title="Flows"
        subtitle="Save a flow from any brand as a global preset, then duplicate it to selected brands as a draft in one click."
      />
      <div className="mt-6">
        <AdminFlowPushPanel />
      </div>
    </div>
  );
}
