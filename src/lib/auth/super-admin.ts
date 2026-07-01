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

export interface SuperAdminBrandContext {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string;
  brand: { id: string; name: string };
}

/** Super admin only — brand must belong to the caller's organization. */
export async function requireSuperAdminBrand(
  brandId: string,
): Promise<SuperAdminBrandContext> {
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

  const { data: brand } = await supabase
    .from("accounts")
    .select("id, name, organization_id")
    .eq("id", brandId)
    .maybeSingle();

  if (!brand || brand.organization_id !== member.organization_id) {
    throw new ForbiddenError("Brand not found");
  }

  return {
    supabase,
    userId: user.id,
    organizationId: member.organization_id,
    brand: { id: brand.id, name: brand.name },
  };
}
