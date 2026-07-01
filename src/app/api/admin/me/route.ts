// ============================================================
// /api/admin/me — organization + super-admin context for the UI.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { fetchOrganizationMembership } from "@/lib/auth/organization";
import { toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const org = await fetchOrganizationMembership(supabase, user.id);
    if (org) {
      return NextResponse.json({
        isSuperAdmin: true,
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        actingAccountId: org.actingAccountId,
        actingAccountName: org.actingAccountName,
        needsBrandContext: !org.actingAccountId,
        canClaimSuperAdmin: false,
      });
    }

    const allowedEmail = process.env.RECOVER_AGENT_SUPER_ADMIN_EMAIL
      ?.trim()
      .toLowerCase();
    const emailMatches =
      Boolean(allowedEmail) &&
      user.email?.toLowerCase() === allowedEmail;

    let hasSuperAdmin = false;
    if (emailMatches) {
      const admin = supabaseAdmin();
      const { count } = await admin
        .from("organization_members")
        .select("id", { count: "exact", head: true });
      hasSuperAdmin = (count ?? 0) > 0;
    }

    return NextResponse.json({
      isSuperAdmin: false,
      canClaimSuperAdmin: emailMatches && !hasSuperAdmin,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
