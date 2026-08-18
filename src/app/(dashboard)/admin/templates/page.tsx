'use client';

import { AdminTemplatePushPanel } from '@/components/admin/admin-template-push-panel';
import { PageHeader } from '@/components/layout/page-header';

export default function AdminTemplatesPage() {
  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Admin"
        title="Templates"
        subtitle="Create a WhatsApp message template once and submit it to Meta for selected brands in one click. Each brand needs WhatsApp connected."
      />
      <div className="mt-6">
        <AdminTemplatePushPanel />
      </div>
    </div>
  );
}
