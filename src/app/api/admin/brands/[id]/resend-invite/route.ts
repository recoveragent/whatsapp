// POST /api/admin/brands/[id]/resend-invite
//
// Super admin only. Issues a fresh brand-admin invite when the
// previous one was never accepted or the auth user was deleted.

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  ForbiddenError,
  toErrorResponse,
  UnauthorizedError,
} from "@/lib/auth/account";
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host")?.trim();
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

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
  console.error("[resend-invite] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to resend invitation" },
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

    let adminEmail =
      typeof body?.adminEmail === "string"
        ? body.adminEmail.trim().toLowerCase()
        : "";

    if (!adminEmail) {
      const { data: pending } = await supabase
        .from("account_invitations")
        .select("invited_email")
        .eq("account_id", id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      adminEmail =
        typeof pending?.invited_email === "string"
          ? pending.invited_email.trim().toLowerCase()
          : "";
    }

    if (!adminEmail || !adminEmail.includes("@")) {
      return NextResponse.json(
        { error: "Valid admin email is required" },
        { status: 400 },
      );
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(clampExpiryDays(7));
    const baseUrl = getBaseUrl(request);
    const url = inviteUrl(token, baseUrl);

    const { data: row, error } = await supabase.rpc(
      "resend_brand_admin_invite",
      {
        p_account_id: id,
        p_admin_email: adminEmail,
        p_token_hash: hash,
        p_expires_at: expiresAt.toISOString(),
      },
    );

    if (error) return rpcErrorToResponse(error);

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const admin = supabaseAdmin();
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        adminEmail,
        {
          redirectTo: url,
          data: { full_name: adminEmail.split("@")[0] ?? "Admin" },
        },
      );
      if (inviteErr) {
        emailError = inviteErr.message;
      } else {
        emailSent = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Invite email failed";
    }

    return NextResponse.json({
      ok: true,
      accountId: (row as { account_id: string }).account_id,
      invitationId: (row as { invitation_id: string }).invitation_id,
      inviteUrl: url,
      emailSent,
      emailError,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
