"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { BRAND_ICON_PATH, BRAND_NAME } from "@/components/brand/brand-logo";
import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Crown,
  FileText,
  GitBranch,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  PhoneCall,
  Radio,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    className: "border-border bg-card text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

const homeItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

const workspaceItems: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/leads", label: "Leads", icon: PhoneCall },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
];

const automationItems: NavItem[] = [
  { href: "/broadcasts", label: "Broadcasts", icon: Radio },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/flows", label: "Flows", icon: Workflow, beta: true },
];

const bottomNavItems: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({
  open = false,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    profile,
    profileLoading,
    account,
    accountRole,
    signOut,
    isSuperAdmin,
    isSuperAdminActing,
    isLeadGenBrand,
  } = useAuth();
  const opsOnlyNav = isSuperAdmin && !isSuperAdminActing;
  const brandAdminId = pathname.match(/^\/admin\/brands\/([^/]+)\//)?.[1] ?? null;
  const templatesHref = brandAdminId
    ? `/admin/brands/${brandAdminId}/templates`
    : isSuperAdminActing
      ? "/settings?tab=templates"
      : "/admin/templates";
  const templatesActive = brandAdminId
    ? pathname.startsWith(`/admin/brands/${brandAdminId}/templates`)
    : isSuperAdminActing
      ? pathname === "/settings" && searchParams.get("tab") === "templates"
      : pathname.startsWith("/admin/templates");
  const totalUnread = useTotalUnread();
  const showAccountStrip =
    !opsOnlyNav &&
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const filterWorkspace = (items: NavItem[]) =>
    items.filter((item) => item.href !== "/pipelines" || isLeadGenBrand);

  return (
    <TooltipProvider delay={0}>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-black/60 transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-sidebar-border bg-sidebar",
          "w-[min(260px,85vw)] transition-[width,transform] duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
          collapsed ? "lg:w-[60px]" : "lg:w-[220px]",
        )}
        aria-label="Primary"
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3",
            collapsed && "lg:justify-center lg:px-2",
          )}
        >
          <Link
            href={opsOnlyNav ? "/admin/brands" : "/dashboard"}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Image
              src={BRAND_ICON_PATH}
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-lg"
              priority
            />
            <div className={cn("min-w-0", collapsed && "lg:hidden")}>
              <p className="truncate text-[13px] font-bold text-sidebar-foreground">
                {BRAND_NAME}
              </p>
              {account?.name ? (
                <p className="truncate text-[10px] text-muted-foreground">
                  {account.name}
                </p>
              ) : null}
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {!opsOnlyNav ? (
            <>
              <NavSection
                label="Home"
                collapsed={collapsed}
                items={homeItems}
                pathname={pathname}
                totalUnread={totalUnread}
              />
              <NavSection
                label="Workspace"
                collapsed={collapsed}
                items={filterWorkspace(workspaceItems)}
                pathname={pathname}
                totalUnread={totalUnread}
              />
              <NavSection
                label="Automation"
                collapsed={collapsed}
                items={automationItems}
                pathname={pathname}
                totalUnread={totalUnread}
              />
            </>
          ) : (
            <p
              className={cn(
                "mb-2 px-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase",
                collapsed && "lg:hidden",
              )}
            >
              Recover Agent
            </p>
          )}

          <div className="my-3 h-px bg-sidebar-border" />

          {isSuperAdmin || !opsOnlyNav ? (
            <p
              className={cn(
                "mb-1 px-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase",
                collapsed && "lg:hidden",
              )}
            >
              Admin
            </p>
          ) : null}

          <ul className="flex flex-col gap-0.5">
            {isSuperAdmin ? (
              <>
                <NavRow
                  href="/admin/brands"
                  label="Brands"
                  icon={Building2}
                  active={pathname.startsWith("/admin/brands")}
                  collapsed={collapsed}
                />
                <NavRow
                  href={templatesHref}
                  label="Templates"
                  icon={FileText}
                  active={templatesActive}
                  collapsed={collapsed}
                />
              </>
            ) : null}
            {!opsOnlyNav &&
              bottomNavItems.map((item) => (
                <NavRow
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={pathname.startsWith(item.href)}
                  collapsed={collapsed}
                />
              ))}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2">
          {showAccountStrip && account?.name && !collapsed ? (
            <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <UsersRound className="size-3.5 shrink-0" />
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <span
                        className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${meta.className}`}
                      >
                        <Icon className="size-3" />
                        {meta.label}
                      </span>
                    );
                  })()
                : null}
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60 focus:bg-sidebar-accent/60 focus:outline-none data-popup-open:bg-sidebar-accent/60",
                collapsed && "lg:justify-center lg:px-0",
              )}
            >
              <Avatar className="size-8 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/15 text-sm font-medium text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
                <p className="truncate text-[13px] font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              {!opsOnlyNav ? (
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=whatsapp"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                    />
                  }
                >
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="mt-1 hidden w-full items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground lg:flex"
            >
              {collapsed ? (
                <ChevronsRight className="mx-auto h-4 w-4" />
              ) : (
                <>
                  <ChevronsLeft className="h-4 w-4" />
                  Collapse
                </>
              )}
            </button>
          ) : null}
        </div>
      </aside>
    </TooltipProvider>
  );
}

function NavSection({
  label,
  items,
  pathname,
  collapsed,
  totalUnread,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  totalUnread: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3">
      <p
        className={cn(
          "mb-1 px-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase",
          collapsed && "lg:hidden",
        )}
      >
        {label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const showUnreadDot =
            item.href === "/inbox" && totalUnread > 0 && !isActive;
          return (
            <NavRow
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive}
              collapsed={collapsed}
              beta={item.beta}
              unread={showUnreadDot ? totalUnread : 0}
            />
          );
        })}
      </ul>
    </div>
  );
}

function NavRow({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  beta,
  unread = 0,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  collapsed: boolean;
  beta?: boolean;
  unread?: number;
}) {
  return (
    <li>
      <Link
        href={href}
        title={collapsed ? label : undefined}
        className={cn(
          "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors duration-150",
          collapsed && "lg:justify-center lg:px-0",
          active
            ? "bg-sidebar-accent font-semibold text-primary"
            : "font-normal text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        {active ? (
          <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
        ) : null}
        <Icon className="h-4 w-4 shrink-0" />
        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
          {label}
        </span>
        {beta ? (
          <span
            aria-label="Beta feature"
            className={cn(
              "rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-700 uppercase",
              collapsed && "lg:hidden",
            )}
          >
            Beta
          </span>
        ) : null}
        {unread > 0 ? (
          <span
            aria-label={`${unread} unread conversation${unread === 1 ? "" : "s"}`}
            className={cn("relative flex h-2 w-2", collapsed && "lg:hidden")}
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
        ) : null}
      </Link>
    </li>
  );
}
