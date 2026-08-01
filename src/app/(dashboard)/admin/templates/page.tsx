'use client';

import { AdminTemplatePushPanel } from '@/components/admin/admin-template-push-panel';

export default function AdminTemplatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Templates
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a WhatsApp message template once and submit it to Meta for
        selected brands in one click. Each brand needs WhatsApp connected.
      </p>
      <div className="mt-6">
        <AdminTemplatePushPanel />
      </div>
    </div>
  );
}
