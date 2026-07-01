// ============================================================
// Organization / super-admin helpers — server-only.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AccountRole } from "./roles";

export interface OrganizationContext {
  organizationId: string;
  organizationName: string;
  isSuperAdmin: true;
  /** Brand the super admin is currently acting in. Null until they pick one. */
  actingAccountId: string | null;
  actingAccountName: string | null;
}

export async function fetchOrganizationMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<OrganizationContext | null> {
  const { data: member, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !member?.organization_id) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", member.organization_id)
    .maybeSingle();

  if (!org) return null;

  const { data: ctx } = await supabase
    .from("organization_admin_context")
    .select("acting_account_id")
    .eq("user_id", userId)
    .maybeSingle();

  let actingAccountName: string | null = null;
  if (ctx?.acting_account_id) {
    const { data: brand } = await supabase
      .from("accounts")
      .select("name")
      .eq("id", ctx.acting_account_id)
      .maybeSingle();
    actingAccountName = brand?.name ?? null;
  }

  return {
    organizationId: org.id,
    organizationName: org.name,
    isSuperAdmin: true,
    actingAccountId: ctx?.acting_account_id ?? null,
    actingAccountName,
  };
}

/** Effective brand role when a super admin is acting in a brand. */
export const SUPER_ADMIN_ACTING_ROLE: AccountRole = "admin";
