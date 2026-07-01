import { NextResponse } from "next/server";

import {
  BrandContextRequiredError,
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
  UnauthorizedError,
} from "@/lib/auth/account";
import { fetchOrganizationMembership } from "@/lib/auth/organization";
import { canEditSettings, canSendMessages } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function pendingInviteHint(email: string | undefined) {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("account_invitations")
    .select("account_id")
    .eq("invited_email", normalized)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.account_id) return null;

  const { data: account } = await admin
    .from("accounts")
    .select("name")
    .eq("id", data.account_id)
    .maybeSingle();

  const accountName = account?.name ?? "your brand";

  return {
    pendingInvite: true as const,
    brandName: accountName,
    message:
      `You have a pending invite to ${accountName}. Open the invite link from your email and click Accept — signing up alone does not join the workspace.`,
  };
}

/**
 * GET /api/account/context
 *
 * Server-authoritative workspace context for the signed-in user.
 * Prefer this over client-side profile reads when gating workspace APIs.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      linked: true,
      needsBrandContext: false,
      accountId: ctx.accountId,
      accountName: ctx.account.name,
      role: ctx.role,
      canEditSettings: canEditSettings(ctx.role),
      canSendMessages: canSendMessages(ctx.role),
      isSuperAdminActing: ctx.isSuperAdminActing ?? false,
      organizationName: ctx.organizationName ?? null,
    });
  } catch (err) {
    if (err instanceof BrandContextRequiredError) {
      return NextResponse.json({
        linked: false,
        needsBrandContext: true,
        message: err.message,
      });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const org = user
        ? await fetchOrganizationMembership(supabase, user.id)
        : null;
      if (org?.isSuperAdmin && !org.actingAccountId) {
        return NextResponse.json({
          linked: false,
          needsBrandContext: true,
          message: "Select a brand to continue",
        });
      }

      const invite = user ? await pendingInviteHint(user.email) : null;
      if (invite) {
        return NextResponse.json({
          linked: false,
          needsBrandContext: false,
          ...invite,
        });
      }

      return NextResponse.json({
        linked: false,
        needsBrandContext: false,
        message: err.message,
      });
    }
    return toErrorResponse(err);
  }
}
