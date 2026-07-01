'use client';

import { useParams } from 'next/navigation';

import { ShopifyConfig } from '@/components/settings/shopify-config';

export default function BrandShopifySetupPage() {
  const params = useParams();
  const brandId = typeof params.id === 'string' ? params.id : '';

  if (!brandId) {
    return <p className="text-sm text-muted-foreground">Invalid brand.</p>;
  }

  return (
    <div>
      <ShopifyConfig brandId={brandId} />
    </div>
  );
}
