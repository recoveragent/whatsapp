"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSED_KEY = "wacrm.sidebar.collapsed";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    profileLoading,
    profile,
    isSuperAdmin,
    isSuperAdminActing,
    needsBrandContext,
    canClaimSuperAdmin,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore persisted sidebar width after mount (SSR-safe)
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Persistence is best-effort.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || profileLoading || !user) return;
    const onAdmin = pathname.startsWith("/admin");
    if (isSuperAdmin && !isSuperAdminActing) {
      if (!onAdmin) router.replace("/admin/brands");
      return;
    }
    if (needsBrandContext || canClaimSuperAdmin) {
      if (!onAdmin) router.replace("/admin/brands");
    }
  }, [
    loading,
    profileLoading,
    user,
    isSuperAdmin,
    isSuperAdminActing,
    needsBrandContext,
    canClaimSuperAdmin,
    pathname,
    router,
  ]);

  // Full-screen gate only for the initial session/profile load.
  // refreshProfile() also sets profileLoading — remounting the tree on
  // every refresh caused an infinite loop on /admin/brands (clear-context
  // → refreshProfile → spinner → remount → clear-context …).
  if (loading || (profileLoading && !profile)) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isFullHeightEditor =
    pathname !== null && /^\/flows\/[^/]+$/.test(pathname);

  return (
    <div className="h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
      />
      <div
        className={cn(
          "flex h-screen flex-col overflow-hidden transition-[margin] duration-200",
          sidebarCollapsed ? "lg:ml-[60px]" : "lg:ml-[220px]",
        )}
      >
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main
          className={cn(
            "flex-1 px-4 py-5 lg:px-9 lg:py-7",
            isFullHeightEditor
              ? "flex min-h-0 flex-col overflow-hidden"
              : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
