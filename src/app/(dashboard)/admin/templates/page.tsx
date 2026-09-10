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
        subtitle="Pick a built-in or saved template, edit and save for reuse, select brands to push to, and submit to Meta in one click. Each brand needs WhatsApp connected."
      />
      <div className="mt-6">
        <AdminTemplatePushPanel />
      </div>
    </div>
  );
}
