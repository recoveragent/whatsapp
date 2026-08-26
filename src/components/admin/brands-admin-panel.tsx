'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  Building2,
  IndianRupee,
  Loader2,
  LogIn,
  PlugZap,
  Plus,
  Shield,
  ShoppingBag,
  Store,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import {
  BRAND_CATEGORY_LABELS,
  type BrandCategory,
} from '@/lib/auth/brand-category';
import {
  ECOMMERCE_PLATFORM_LABELS,
  type EcommercePlatform,
} from '@/lib/ecommerce/platform';

interface BrandRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: string;
  brand_category: BrandCategory;
  ecommerce_platform?: EcommercePlatform | null;
  admin_email: string | null;
  invite_pending: boolean;
  invite_expired?: boolean;
  can_assign_admin?: boolean;
  can_complete_invite?: boolean;
}

export function BrandsAdminPanel() {
  const router = useRouter();
  const { isSuperAdmin, canClaimSuperAdmin, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [brandName, setBrandName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [brandCategory, setBrandCategory] = useState<BrandCategory>('lead_gen');
  const [ecommercePlatform, setEcommercePlatform] = useState<EcommercePlatform>('shopify');
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [completingInviteId, setCompletingInviteId] = useState<string | null>(null);
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const [updatingCategoryId, setUpdatingCategoryId] = useState<string | null>(null);
  const [categoryMigrationNeeded, setCategoryMigrationNeeded] = useState(false);
  const didClearContext = useRef(false);

  const loadBrands = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/brands');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to load brands');
      }
      const data = await res.json();
      setBrands(data.brands ?? []);
      setCategoryMigrationNeeded(Boolean(data.categoryColumnMissing));
      if (data.categoryColumnMissing && data.migrationHint) {
        toast.message('Brand categories need a database migration', {
          description: data.migrationHint,
          duration: 8000,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load brands');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      if (!didClearContext.current) {
        didClearContext.current = true;
        void fetch('/api/admin/brands/clear-context', { method: 'POST' })
          .then(() => refreshProfile())
          .catch(() => undefined);
      }
      void loadBrands();
    } else {
      setLoading(false);
    }
  }, [isSuperAdmin, loadBrands, refreshProfile]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const res = await fetch('/api/admin/claim-super-admin', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not claim super admin');
      toast.success('You are now the Recover Agent super admin');
      await refreshProfile();
      await loadBrands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setLastInviteUrl(null);
    try {
      const res = await fetch('/api/admin/brands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: brandName,
          adminEmail,
          category: brandCategory,
          ecommercePlatform: brandCategory === 'ecommerce' ? ecommercePlatform : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to create brand');

      if (body.emailSent) {
        toast.success(`Brand created — invite sent to ${adminEmail}`);
      } else {
        toast.success('Brand created — copy the invite link below');
        if (body.inviteUrl) setLastInviteUrl(body.inviteUrl);
        if (body.emailError) {
          toast.message(`Email not sent: ${body.emailError}`);
        }
      }

      setBrandName('');
      setAdminEmail('');
      setBrandCategory('lead_gen');
      setEcommercePlatform('shopify');
      await loadBrands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenBrand = async (id: string) => {
    setSwitchingId(id);
    try {
      const res = await fetch(`/api/admin/brands/${id}/switch`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not open brand');
      didClearContext.current = true;
      await refreshProfile();
      toast.success('Opened brand as admin');
      router.push('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open brand');
    } finally {
      setSwitchingId(null);
    }
  };

  const handleAssignAdmin = async (id: string, adminEmail: string | null) => {
    const label = adminEmail ?? 'this user';
    if (
      !confirm(
        `Assign ${label} as admin of this brand? Their login will be linked to this workspace immediately.`,
      )
    ) {
      return;
    }
    setCompletingInviteId(id);
    try {
      const res = await fetch(`/api/admin/brands/${id}/complete-invite`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not assign admin');
      toast.success(
        adminEmail ? `${adminEmail} is now the brand admin` : 'Brand admin assigned',
      );
      await loadBrands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign admin');
    } finally {
      setCompletingInviteId(null);
    }
  };

  const handleResendInvite = async (id: string, adminEmail: string | null) => {
    setResendingInviteId(id);
    try {
      const res = await fetch(`/api/admin/brands/${id}/resend-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          adminEmail ? { adminEmail } : {},
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not resend invitation');
      if (body.emailSent) {
        toast.success(
          adminEmail
            ? `Fresh invite sent to ${adminEmail}`
            : 'Fresh invite sent',
        );
      } else {
        toast.success('Fresh invite link created — copy it below');
        if (body.inviteUrl) setLastInviteUrl(body.inviteUrl);
        if (body.emailError) {
          toast.message(`Email not sent: ${body.emailError}`);
        }
      }
      await loadBrands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resend invitation');
    } finally {
      setResendingInviteId(null);
    }
  };

  const handleCategoryChange = async (brandId: string, category: BrandCategory) => {
    setUpdatingCategoryId(brandId);
    try {
      const res = await fetch(`/api/admin/brands/${brandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to update category');
      setBrands((prev) =>
        prev.map((b) => (b.id === brandId ? { ...b, brand_category: category } : b)),
      );
      toast.success('Brand category updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdatingCategoryId(null);
    }
  };

  if (canClaimSuperAdmin) {
    return (
      <Card className="max-w-lg border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="size-5 text-primary" />
            Recover Agent setup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            No super admin is assigned yet. Claim the Recover Agent super admin
            role to create brands and invite brand admins.
          </p>
          <Button onClick={handleClaim} disabled={claiming}>
            {claiming ? <Loader2 className="size-4 animate-spin" /> : 'Become super admin'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!isSuperAdmin) {
    return (
      <Card className="max-w-lg border-border">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Super admin access required.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Brands</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create brands, invite their admins, and configure WhatsApp and Shopify
          per brand. Brand admins use the CRM inbox and campaigns themselves.
        </p>
        {categoryMigrationNeeded ? (
          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            Brand categories require migration 032. Run{' '}
            <code className="text-xs">supabase/migrations/032_brand_category.sql</code>{' '}
            in Supabase until then all brands default to Lead gen.
          </p>
        ) : null}
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" />
            New brand
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brandName">Brand name</Label>
              <Input
                id="brandName"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Wellness Recovery"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adminEmail">Brand admin email</Label>
              <Input
                id="adminEmail"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@brand.com"
                required
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="brandCategory">Category</Label>
              <select
                id="brandCategory"
                value={brandCategory}
                onChange={(e) => setBrandCategory(e.target.value as BrandCategory)}
                className="flex h-9 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary/50"
              >
                <option value="lead_gen">Lead gen — pipelines & deals</option>
                <option value="ecommerce">Ecommerce — store & orders</option>
              </select>
            </div>
            {brandCategory === 'ecommerce' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ecommercePlatform">Store platform</Label>
                <select
                  id="ecommercePlatform"
                  value={ecommercePlatform}
                  onChange={(e) => setEcommercePlatform(e.target.value as EcommercePlatform)}
                  className="flex h-9 w-full rounded-md border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary/50"
                >
                  <option value="shopify">{ECOMMERCE_PLATFORM_LABELS.shopify}</option>
                  <option value="woocommerce">{ECOMMERCE_PLATFORM_LABELS.woocommerce}</option>
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  'Create brand & send invite'
                )}
              </Button>
            </div>
          </form>
          {lastInviteUrl ? (
            <p className="mt-4 break-all rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              Invite link:{' '}
              <a href={lastInviteUrl} className="text-primary underline">
                {lastInviteUrl}
              </a>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" />
            All brands
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : brands.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No brands yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {brands.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{b.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <select
                        value={b.brand_category ?? 'lead_gen'}
                        disabled={updatingCategoryId === b.id}
                        onChange={(e) =>
                          void handleCategoryChange(b.id, e.target.value as BrandCategory)
                        }
                        className="h-7 rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary/50 disabled:opacity-50"
                      >
                        <option value="lead_gen">{BRAND_CATEGORY_LABELS.lead_gen}</option>
                        <option value="ecommerce">{BRAND_CATEGORY_LABELS.ecommerce}</option>
                      </select>
                    </div>
                    {b.admin_email ? (
                      <p className="text-sm text-muted-foreground">{b.admin_email}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {b.owner_user_id
                        ? 'Admin assigned'
                        : b.can_complete_invite
                          ? 'Signed up — assign manually below'
                          : b.invite_expired
                            ? b.admin_email
                              ? `Invite expired for ${b.admin_email} — assign or resend`
                              : 'Invite expired — assign or resend'
                            : b.invite_pending
                              ? b.admin_email
                                ? `Invite pending for ${b.admin_email}`
                                : 'Invite pending'
                              : 'Awaiting admin invite'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {b.can_assign_admin ? (
                      <Button
                        size="sm"
                        disabled={completingInviteId === b.id}
                        onClick={() => void handleAssignAdmin(b.id, b.admin_email)}
                      >
                        {completingInviteId === b.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          'Assign admin'
                        )}
                      </Button>
                    ) : null}
                    {b.invite_pending || b.invite_expired || b.can_assign_admin ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resendingInviteId === b.id}
                        onClick={() => void handleResendInvite(b.id, b.admin_email)}
                      >
                        {resendingInviteId === b.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          'Resend invite'
                        )}
                      </Button>
                    ) : null}
                    <Link
                      href={`/admin/brands/${b.id}/whatsapp`}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      <PlugZap className="size-4" />
                      WhatsApp setup
                    </Link>
                    <Link
                      href={`/admin/brands/${b.id}/pricing`}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      <IndianRupee className="size-4" />
                      Billing
                    </Link>
                    {b.brand_category === 'ecommerce' &&
                    (b.ecommerce_platform ?? 'shopify') === 'shopify' ? (
                      <Link
                        href={`/admin/brands/${b.id}/shopify`}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        <ShoppingBag className="size-4" />
                        Shopify setup
                      </Link>
                    ) : null}
                    {b.brand_category === 'ecommerce' &&
                    b.ecommerce_platform === 'woocommerce' ? (
                      <Link
                        href={`/admin/brands/${b.id}/woocommerce`}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        <Store className="size-4" />
                        WooCommerce setup
                      </Link>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={switchingId === b.id}
                      onClick={() => void handleOpenBrand(b.id)}
                    >
                      {switchingId === b.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          <LogIn className="mr-1.5 size-4" />
                          Open as admin
                        </>
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
