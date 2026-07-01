// ============================================================
// /api/admin/claim-super-admin — one-time bootstrap for Recover
// Agent super admin. Requires RECOVER_AGENT_SUPER_ADMIN_EMAIL to
// match the signed-in user's email and no existing org members.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { toErrorResponse } from "@/lib/auth/account";

export async function POST() {
  try {
    const allowed = process.env.RECOVER_AGENT_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    if (!allowed) {
      return NextResponse.json(
        { error: "RECOVER_AGENT_SUPER_ADMIN_EMAIL is not configured" },
        { status: 503 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.email.toLowerCase() !== allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase.rpc("claim_super_admin", {
      p_email: user.email,
    });

    if (error) {
      console.error("[POST /api/admin/claim-super-admin]", error);
      const code = error.code === "23505" ? 409 : 400;
      return NextResponse.json(
        { error: error.message ?? "Could not claim super admin" },
        { status: code },
      );
    }

    return NextResponse.json({ organizationId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
