// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  fetchOrganizationMembership,
  SUPER_ADMIN_ACTING_ROLE,
} from "./organization";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Super admin has not picked a brand to act in yet. */
export class BrandContextRequiredError extends ForbiddenError {
  readonly needsBrandContext = true as const;
  constructor(message = "Select a brand to continue") {
    super(message);
    this.name = "BrandContextRequiredError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof BrandContextRequiredError) {
    return NextResponse.json(
      { error: err.message, needsBrandContext: true },
      { status: err.status },
    );
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Active brand id (profile account or super-admin acting brand). */
  accountId: string;
  /** Effective role within the active brand. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
  /** True when the caller is a Recover Agent super admin acting in a brand. */
  isSuperAdminActing?: boolean;
  organizationId?: string;
  organizationName?: string;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 */
export async function getCurrentAccount(): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }

  // Super admin always uses the brand they opened — not a stale profile.account_id.
  const org = await fetchOrganizationMembership(supabase, user.id);
  if (org) {
    if (!org.actingAccountId) {
      throw new BrandContextRequiredError();
    }

    const { data: account, error: accountErr } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("id", org.actingAccountId)
      .maybeSingle();

    if (accountErr || !account) {
      console.error("[getCurrentAccount] acting brand fetch error:", accountErr);
      throw new ForbiddenError("Could not load brand context");
    }

    return {
      supabase,
      userId: user.id,
      accountId: org.actingAccountId,
      role: SUPER_ADMIN_ACTING_ROLE,
      account: { id: account.id, name: account.name },
      isSuperAdminActing: true,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
    };
  }

  if (data?.account_id && data.account_role && isAccountRole(data.account_role)) {
    const { data: account, error: accountErr } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("id", data.account_id)
      .maybeSingle();

    if (accountErr) {
      console.error("[getCurrentAccount] account fetch error:", accountErr);
      throw new ForbiddenError("Could not load account context");
    }
    if (!account) {
      throw new ForbiddenError("Profile is not linked to an account");
    }

    return {
      supabase,
      userId: user.id,
      accountId: data.account_id,
      role: data.account_role,
      account: { id: account.id, name: account.name },
    };
  }

  throw new ForbiddenError("Profile is not linked to an account");
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
