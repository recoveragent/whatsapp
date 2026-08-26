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
import { isEcommercePlatform } from "@/lib/ecommerce/platform";
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

    const admin = supabaseAdmin();
    const brandIds = brands.map((b) => b.id);

    const { data: unredeemedInvites } =
      brandIds.length > 0
        ? await admin
            .from("account_invitations")
            .select("id, account_id, invited_email, role, expires_at, created_at")
            .in("account_id", brandIds)
            .is("accepted_at", null)
            .order("created_at", { ascending: false })
        : { data: [] as never[] };

    type InviteRow = NonNullable<typeof unredeemedInvites>[number];
    const latestUnredeemedByAccount = new Map<string, InviteRow>();
    const activePendingByAccount = new Map<string, InviteRow>();
    const nowIso = new Date().toISOString();

    for (const inv of unredeemedInvites ?? []) {
      const accountId = inv.account_id as string;
      if (!latestUnredeemedByAccount.has(accountId)) {
        latestUnredeemedByAccount.set(accountId, inv);
      }
      if (
        typeof inv.expires_at === "string" &&
        inv.expires_at > nowIso &&
        !activePendingByAccount.has(accountId)
      ) {
        activePendingByAccount.set(accountId, inv);
      }
    }

    const pending = [...activePendingByAccount.values()];

    const ownerIds = brands
      .map((b) => b.owner_user_id)
      .filter((id): id is string => Boolean(id));

    const pendingInviteEmails = [...latestUnredeemedByAccount.values()]
      .map((inv) =>
        typeof inv.invited_email === "string"
          ? inv.invited_email.trim().toLowerCase()
          : "",
      )
      .filter(Boolean);

    const emailByUserId = new Map<string, string>();
    const signedUpInviteEmails = new Set<string>();
    if (ownerIds.length > 0) {
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
    if (pendingInviteEmails.length > 0) {
      const { data: inviteeProfiles } = await admin.from("profiles").select("email");
      for (const row of inviteeProfiles ?? []) {
        const email =
          typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
        if (email && pendingInviteEmails.includes(email)) {
          signedUpInviteEmails.add(email);
        }
      }
    }

    const brandRows = brands.map((brand) => {
      const activeInvite = activePendingByAccount.get(brand.id);
      const latestInvite = latestUnredeemedByAccount.get(brand.id);
      const inviteForEmail = latestInvite ?? activeInvite;
      const invitedEmail =
        typeof inviteForEmail?.invited_email === "string"
          ? inviteForEmail.invited_email.trim().toLowerCase()
          : "";
      const adminEmail = brand.owner_user_id
        ? (emailByUserId.get(brand.owner_user_id) ?? null)
        : invitedEmail || null;
      const invitePending = !brand.owner_user_id && Boolean(activeInvite);
      const inviteExpired =
        !brand.owner_user_id &&
        Boolean(latestInvite) &&
        !activeInvite &&
        invitedEmail.length > 0;
      const needsAdmin = !brand.owner_user_id;

      return {
        ...brand,
        admin_email: adminEmail,
        invite_pending: invitePending,
        invite_expired: inviteExpired,
        can_assign_admin: needsAdmin,
        can_complete_invite:
          needsAdmin &&
          invitedEmail.length > 0 &&
          signedUpInviteEmails.has(invitedEmail),
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
      ecommercePlatform?: unknown;
    } | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const adminEmail =
      typeof body?.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
    const category = isBrandCategory(body?.category) ? body.category : "lead_gen";
    const ecommercePlatform = isEcommercePlatform(body?.ecommercePlatform)
      ? body.ecommercePlatform
      : "shopify";

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
        p_ecommerce_platform: category === "ecommerce" ? ecommercePlatform : null,
      },
    );

    if (created.error && isMissingRpcOverloadError(created.error)) {
      created = await supabase.rpc("create_brand_with_admin_invite", {
        p_brand_name: name,
        p_admin_email: adminEmail,
        p_token_hash: hash,
        p_expires_at: expiresAt.toISOString(),
        p_brand_category: category,
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
        brand: {
          id: row.account_id,
          name,
          brand_category: category,
          ecommerce_platform: category === "ecommerce" ? ecommercePlatform : null,
        },
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
