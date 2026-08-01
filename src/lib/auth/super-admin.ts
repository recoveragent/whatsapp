import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";

export async function isSuperAdminUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export interface SuperAdminContext {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string;
}

export interface SuperAdminBrandContext extends SuperAdminContext {
  brand: { id: string; name: string };
}

/** Super admin only — Recover Agent ops membership. */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new UnauthorizedError();

  const { data: member } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member?.organization_id) {
    throw new ForbiddenError("Recover Agent ops access required");
  }

  return {
    supabase,
    userId: user.id,
    organizationId: member.organization_id,
  };
}

/** Super admin only — brand must belong to the caller's organization. */
export async function requireSuperAdminBrand(
  brandId: string,
): Promise<SuperAdminBrandContext> {
  const ctx = await requireSuperAdmin();

  const { data: brand } = await ctx.supabase
    .from("accounts")
    .select("id, name, organization_id")
    .eq("id", brandId)
    .maybeSingle();

  if (!brand || brand.organization_id !== ctx.organizationId) {
    throw new ForbiddenError("Brand not found");
  }

  return {
    ...ctx,
    brand: { id: brand.id, name: brand.name },
  };
}
