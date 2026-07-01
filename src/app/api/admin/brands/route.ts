// ============================================================
// /api/admin/brands — list + create brands under Recover Agent.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { toErrorResponse, UnauthorizedError, ForbiddenError } from "@/lib/auth/account";
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { isBrandCategory } from "@/lib/auth/brand-category";
import {
  BRAND_CATEGORY_MIGRATION_HINT,
  isMissingColumnError,
  isMissingRpcOverloadError,
  listOrganizationBrands,
} from "@/lib/auth/brand-accounts";
import { supabaseAdmin } from "@/lib/supabase/admin";

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")?.trim();
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
      ?? new URL(request.url).protocol.replace(":", "");
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

  return { supabase, userId: user.id, organizationId: member.organization_id };
}

export async function GET() {
  try {
    const { supabase, organizationId } = await requireSuperAdmin();

    let brands: Awaited<ReturnType<typeof listOrganizationBrands>>["brands"];
    let categoryColumnMissing = false;
    try {
      const result = await listOrganizationBrands(supabase, organizationId);
      brands = result.brands;
      categoryColumnMissing = result.categoryColumnMissing;
    } catch (error) {
      console.error("[GET /api/admin/brands]", error);
      return NextResponse.json({ error: "Failed to load brands" }, { status: 500 });
    }

    const { data: pending } = await supabase
      .from("account_invitations")
      .select("id, account_id, invited_email, role, expires_at, created_at")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString());

    const pendingByAccount = new Map(
      (pending ?? []).map((inv) => [inv.account_id as string, inv]),
    );

    const ownerIds = brands
      .map((b) => b.owner_user_id)
      .filter((id): id is string => Boolean(id));

    const emailByUserId = new Map<string, string>();
    if (ownerIds.length > 0) {
      const admin = supabaseAdmin();
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, email")
        .in("user_id", ownerIds);
      for (const row of profiles ?? []) {
        if (row.user_id && row.email) {
          emailByUserId.set(row.user_id as string, row.email as string);
        }
      }
    }

    const brandRows = brands.map((brand) => {
      const pendingInvite = pendingByAccount.get(brand.id);
      const adminEmail = brand.owner_user_id
        ? (emailByUserId.get(brand.owner_user_id) ?? null)
        : (pendingInvite?.invited_email as string | undefined) ?? null;

      return {
        ...brand,
        admin_email: adminEmail,
        invite_pending: !brand.owner_user_id && Boolean(pendingInvite),
      };
    });

    return NextResponse.json({
      brands: brandRows,
      pendingInvites: pending ?? [],
      categoryColumnMissing,
      migrationHint: categoryColumnMissing ? BRAND_CATEGORY_MIGRATION_HINT : undefined,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, organizationId } = await requireSuperAdmin();

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      adminEmail?: unknown;
      category?: unknown;
    } | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const adminEmail =
      typeof body?.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
    const category = isBrandCategory(body?.category) ? body.category : "lead_gen";

    if (!name) {
      return NextResponse.json({ error: "Brand name is required" }, { status: 400 });
    }
    if (!adminEmail || !adminEmail.includes("@")) {
      return NextResponse.json({ error: "Valid admin email is required" }, { status: 400 });
    }

    const { token, hash } = generateInviteToken();
    const expiresAt = inviteExpiresAt(clampExpiryDays(7));
    const baseUrl = getBaseUrl(request);
    const url = inviteUrl(token, baseUrl);

    let created = await supabase.rpc(
      "create_brand_with_admin_invite",
      {
        p_brand_name: name,
        p_admin_email: adminEmail,
        p_token_hash: hash,
        p_expires_at: expiresAt.toISOString(),
        p_brand_category: category,
      },
    );

    if (created.error && isMissingRpcOverloadError(created.error)) {
      created = await supabase.rpc("create_brand_with_admin_invite", {
        p_brand_name: name,
        p_admin_email: adminEmail,
        p_token_hash: hash,
        p_expires_at: expiresAt.toISOString(),
      });
    }

    const { data: createdRow, error } = created;

    if (error) {
      console.error("[POST /api/admin/brands] rpc error:", error);
      return NextResponse.json(
        { error: error.message ?? "Failed to create brand" },
        { status: 500 },
      );
    }

    const row = createdRow as { account_id: string; invitation_id: string };

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const admin = supabaseAdmin();
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        adminEmail,
        {
          redirectTo: url,
          data: { full_name: name },
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

    return NextResponse.json(
      {
        brand: { id: row.account_id, name, brand_category: category },
        invitationId: row.invitation_id,
        inviteUrl: url,
        emailSent,
        emailError,
        organizationId,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
