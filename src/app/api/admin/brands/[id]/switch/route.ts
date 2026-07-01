// ============================================================
// /api/admin/brands/[id]/switch — super admin acts as brand admin.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { toErrorResponse, UnauthorizedError } from "@/lib/auth/account";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();

    const { data, error } = await supabase.rpc("set_super_admin_acting_brand", {
      p_account_id: id,
    });

    if (error) {
      console.error("[POST /api/admin/brands/switch]", error);
      return NextResponse.json(
        { error: error.message ?? "Could not switch brand" },
        { status: 400 },
      );
    }

    return NextResponse.json({ actingAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
