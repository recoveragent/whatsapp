"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";
import {
  DEFAULT_BRAND_CATEGORY,
  isEcommerceBrand,
  isLeadGenBrand,
  type BrandCategory,
} from "@/lib/auth/brand-category";
import { fetchAccountWithCategory } from "@/lib/auth/brand-accounts";
import { SUPER_ADMIN_ACTING_ROLE } from "@/lib/auth/organization";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  /** Default deal currency (ISO-4217). NOT NULL DEFAULT 'USD' in the
   *  DB (migration 021); narrowed to DEFAULT_CURRENCY when absent. */
  default_currency: string;
  brand_category: BrandCategory;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + default_currency. Null while loading. */
  account: AccountSummary | null;
  /** Account default deal currency. Falls back to DEFAULT_CURRENCY
   *  while loading or when no account is resolved, so callers can use
   *  it unconditionally. */
  defaultCurrency: string;
  /** Brand vertical — set by super admin at brand creation. */
  brandCategory: BrandCategory;
  /** True when pipelines / deals features apply. */
  isLeadGenBrand: boolean;
  /** True when Shopify / order features apply. */
  isEcommerceBrand: boolean;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;

  /** Recover Agent company super admin. */
  isSuperAdmin: boolean;
  organizationName: string | null;
  /** Super admin has not opened a brand yet. */
  needsBrandContext: boolean;
  /** One-time bootstrap available for configured super-admin email. */
  canClaimSuperAdmin: boolean;
  isSuperAdminActing: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getSession() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracked separately from `loading`. The session settles fast (one
  // local cookie read); the profile fetch crosses the network and
  // settles later. Callers that gate on `profile.*` need to know which
  // window they're in — see the type doc above.
  const [profileLoading, setProfileLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [needsBrandContext, setNeedsBrandContext] = useState(false);
  const [canClaimSuperAdmin, setCanClaimSuperAdmin] = useState(false);
  const [isSuperAdminActing, setIsSuperAdminActing] = useState(false);
  const [effectiveRole, setEffectiveRole] = useState<AccountRole | null>(null);
  const [effectiveAccountId, setEffectiveAccountId] = useState<string | null>(null);

  // Shared across init, auth-state-change listener, and the exposed
  // refreshProfile() callback. Reads the current session's user id and
  // pulls the matching profile row along with its account summary.
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    setProfileLoading(true);
    setIsSuperAdmin(false);
    setOrganizationName(null);
    setNeedsBrandContext(false);
    setCanClaimSuperAdmin(false);
    setIsSuperAdminActing(false);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, email, avatar_url, role, beta_features, account_id, account_role",
        )
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("[AuthProvider] fetchProfile error:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }

      if (data) {
        // Load the account with a plain lookup by id instead of an
        // embedded FK join. The embed (`account:accounts!inner(...)`)
        // forces PostgREST to resolve the profiles.account_id →
        // accounts.id relationship from its schema cache; a stale cache
        // (common right after a migration adds the FK) makes it fail
        // hard with PGRST200 and blanks the whole profile — the user
        // then loses account context everywhere (issue #294). A point
        // lookup by id needs no relationship inference, so the profile
        // (with account_id / account_role) still resolves even if the
        // account name lookup itself can't.
        let accountRow: AccountSummary | null = null;
        let role: AccountRole | null = isAccountRole(data.account_role)
          ? data.account_role
          : null;
        let resolvedAccountId = data.account_id ?? null;

        const { data: orgMember } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", userId)
          .maybeSingle();

        if (orgMember?.organization_id) {
          setIsSuperAdmin(true);
          const { data: org } = await supabase
            .from("organizations")
            .select("name")
            .eq("id", orgMember.organization_id)
            .maybeSingle();
          setOrganizationName(org?.name ?? "Recover Agent");

          const { data: ctx } = await supabase
            .from("organization_admin_context")
            .select("acting_account_id")
            .eq("user_id", userId)
            .maybeSingle();

          if (ctx?.acting_account_id) {
            const acting = await fetchAccountWithCategory(supabase, ctx.acting_account_id);
            if (acting) {
              accountRow = {
                id: acting.id,
                name: acting.name,
                default_currency: acting.default_currency ?? DEFAULT_CURRENCY,
                brand_category: acting.brand_category,
              };
              role = SUPER_ADMIN_ACTING_ROLE;
              resolvedAccountId = acting.id;
              setIsSuperAdminActing(true);
              setNeedsBrandContext(false);
            }
          } else {
            setNeedsBrandContext(true);
            role = null;
            resolvedAccountId = null;
            accountRow = null;
          }
        } else if (data.account_id) {
          const account = await fetchAccountWithCategory(supabase, data.account_id);
          if (account) {
            accountRow = {
              id: account.id,
              name: account.name,
              default_currency: account.default_currency ?? DEFAULT_CURRENCY,
              brand_category: account.brand_category,
            };
          }
        } else {
          try {
            const res = await fetch("/api/admin/me");
            if (res.ok) {
              const me = await res.json();
              setCanClaimSuperAdmin(Boolean(me.canClaimSuperAdmin));
            }
          } catch {
            /* ignore */
          }
        }

        setEffectiveRole(role);
        setEffectiveAccountId(resolvedAccountId);

        setProfile({
          id: data.id,
          full_name: data.full_name,
          email: data.email,
          avatar_url: data.avatar_url,
          role: data.role,
          // `beta_features` is `NOT NULL DEFAULT ARRAY[]` in the DB, but
          // narrow defensively in case the column hasn't been migrated yet
          // (older deployments running 011 lazily) — `null` reads as no
          // opt-ins, which is the safe default for any future beta gate.
          beta_features: data.beta_features ?? [],
          account_id: data.account_id ?? null,
          account_role: isAccountRole(data.account_role) ? data.account_role : null,
        });
        setAccount(accountRow);
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn("[AuthProvider] getSession() timed out after 3s");
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) console.error("[AuthProvider] getSession error:", error.message);

        if (!mounted) return;
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          // Don't block session loading on profile fetch — chrome
          // (header, sidebar) can render from the user object alone,
          // profile enriches async. Callers that need to branch on
          // profile data gate on `profileLoading` instead.
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load. Flip profileLoading off so
          // pages that gate on it don't wait forever on the logged-out
          // path (the route guard or redirect should fire instead).
          setProfileLoading(false);
        }
      } catch (err) {
        console.error("[AuthProvider] init threw:", err);
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        fetchProfile(currentUser.id);
      } else {
        setProfile(null);
        setAccount(null);
        setIsSuperAdmin(false);
        setOrganizationName(null);
        setNeedsBrandContext(false);
        setCanClaimSuperAdmin(false);
        setIsSuperAdminActing(false);
        setEffectiveRole(null);
        setEffectiveAccountId(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setAccount(null);
    setIsSuperAdmin(false);
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const role = effectiveRole;
    const brandCategory = account?.brand_category ?? DEFAULT_BRAND_CATEGORY;
    return {
      accountRole: role,
      accountId: effectiveAccountId,
      brandCategory,
      isLeadGenBrand: isLeadGenBrand(brandCategory),
      isEcommerceBrand: isEcommerceBrand(brandCategory),
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [effectiveRole, effectiveAccountId, account?.brand_category]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        isSuperAdmin,
        organizationName,
        needsBrandContext,
        canClaimSuperAdmin,
        isSuperAdminActing,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      brandCategory: DEFAULT_BRAND_CATEGORY,
      isLeadGenBrand: true,
      isEcommerceBrand: false,
      accountId: null,
      accountRole: null,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
      isSuperAdmin: false,
      organizationName: null,
      needsBrandContext: false,
      canClaimSuperAdmin: false,
      isSuperAdminActing: false,
    };
  }
  return ctx;
}
