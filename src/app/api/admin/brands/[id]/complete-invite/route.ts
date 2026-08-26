// POST /api/admin/brands/[id]/complete-invite
//
// Super admin only. Manually links the invited email to this brand
// when /join redeem or confirmation email failed (see migration 062).

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  ForbiddenError,
  toErrorResponse,
  UnauthorizedError,
} from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";

async function requireSuperAdmin() {
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
    throw new ForbiddenError("Super admin access required");
  }

  return supabase;
}

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err.code === "23505") {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error("[complete-invite] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to complete invitation" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await requireSuperAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { adminEmail?: unknown }
      | null;
    const adminEmail =
      typeof body?.adminEmail === "string"
        ? body.adminEmail.trim().toLowerCase()
        : undefined;

    const { data: accountId, error } = await supabase.rpc(
      "complete_brand_admin_invite",
      {
        p_account_id: id,
        ...(adminEmail ? { p_admin_email: adminEmail } : {}),
      },
    );

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    return toErrorResponse(err);
  }
}
