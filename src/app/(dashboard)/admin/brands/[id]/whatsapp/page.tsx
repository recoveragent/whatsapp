'use client';

import { useParams } from 'next/navigation';

import { WhatsAppConfig } from '@/components/settings/whatsapp-config';

export default function BrandWhatsAppSetupPage() {
  const params = useParams();
  const brandId = typeof params.id === 'string' ? params.id : '';

  if (!brandId) {
    return (
      <p className="text-sm text-muted-foreground">Invalid brand.</p>
    );
  }

  return (
    <div>
      <WhatsAppConfig brandId={brandId} />
    </div>
  );
}
