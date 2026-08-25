'use client';

import { useParams } from 'next/navigation';

import { WooCommerceConfig } from '@/components/settings/woocommerce-config';

export default function BrandWooCommerceSetupPage() {
  const params = useParams();
  const brandId = typeof params.id === 'string' ? params.id : '';

  if (!brandId) {
    return <p className="text-sm text-muted-foreground">Invalid brand.</p>;
  }

  return (
    <div>
      <WooCommerceConfig brandId={brandId} />
    </div>
  );
}
