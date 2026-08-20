'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';

/**
 * Super-admin entry to a brand's template catalog.
 *
 * `/admin/templates` is the org-wide push/create tool. This route
 * switches into the brand and lands on Settings → Templates so ops
 * see that client's catalog instead.
 */
export default function BrandTemplatesPage() {
  const params = useParams();
  const router = useRouter();
  const brandId = typeof params.id === 'string' ? params.id : '';
  const { refreshProfile, accountId, isSuperAdminActing } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;

    void (async () => {
      try {
        if (!(isSuperAdminActing && accountId === brandId)) {
          const res = await fetch(`/api/admin/brands/${brandId}/switch`, {
            method: 'POST',
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!res.ok) {
            throw new Error(body.error ?? 'Could not open this brand');
          }
          await refreshProfile();
        }
        if (cancelled) return;
        router.replace('/settings?tab=templates');
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Could not open templates';
        setError(message);
        toast.error(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandId, accountId, isSuperAdminActing, refreshProfile, router]);

  if (!brandId) {
    return <p className="text-sm text-muted-foreground">Invalid brand.</p>;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Link
          href={`/admin/brands/${brandId}/whatsapp`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to WhatsApp setup
        </Link>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-3 py-16">
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Opening brand templates…</p>
    </div>
  );
}
