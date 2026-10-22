"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useInboxNavCounts } from "@/hooks/use-total-unread";
import { BRAND_ICON_PATH, BRAND_NAME } from "@/components/brand/brand-logo";
import {
  Bot,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Settings,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { TooltipProvider } from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  labelKey?: string;
  /** Fallback when no i18n key exists (fork-only nav items). */
  label?: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

const homeItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
];

const workspaceItems: NavItem[] = [
  { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
  { href: "/contacts", labelKey: "contacts", icon: Users },
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
];

const automationItems: NavItem[] = [
  { href: "/broadcasts", labelKey: "broadcasts", icon: Radio },
  { href: "/flows", labelKey: "flows", icon: Workflow },
  { href: "/agents", labelKey: "aiAgents", icon: Bot },
];

const bottomNavItems: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: Settings },
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
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    isSuperAdmin,
    isSuperAdminActing,
    isLeadGenBrand,
    isAiAgentsEnabled,
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
  const { unread: totalUnread, openContacts: openInboxCount } = useInboxNavCounts();

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

  const filterAutomation = (items: NavItem[]) =>
    items.filter((item) => item.href !== "/agents" || isAiAgentsEnabled);

  return (
    <TooltipProvider delay={0}>
      <button
        type="button"
        aria-label={t("closeMenu")}
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
          "fixed inset-y-0 left-0 z-40 flex h-full flex-col bg-sidebar",
          "w-[min(260px,85vw)] transition-[width,transform] duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:shrink-0 lg:translate-x-0",
          collapsed ? "lg:w-[68px]" : "lg:w-[248px]",
        )}
        aria-label="Primary"
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3 lg:hidden",
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
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {!opsOnlyNav ? (
            <>
              <NavSection
                label="Home"
                collapsed={collapsed}
                items={homeItems}
                pathname={pathname}
                totalUnread={totalUnread}
                openInboxCount={openInboxCount}
                t={t}
              />
              <NavSection
                label="Workspace"
                collapsed={collapsed}
                items={filterWorkspace(workspaceItems)}
                pathname={pathname}
                totalUnread={totalUnread}
                openInboxCount={openInboxCount}
                t={t}
              />
              <NavSection
                label="Automation"
                collapsed={collapsed}
                items={filterAutomation(automationItems)}
                pathname={pathname}
                totalUnread={totalUnread}
                openInboxCount={openInboxCount}
                t={t}
              />
            </>
          ) : (
            <p
              className={cn(
                "mb-1.5 px-3 text-xs font-medium text-muted-foreground",
                collapsed && "lg:hidden",
              )}
            >
              Recover Agent
            </p>
          )}

          <div className="my-3 h-px bg-sidebar-border/70" />

          {isSuperAdmin || !opsOnlyNav ? (
            <p
              className={cn(
                "mb-1.5 px-3 text-xs font-medium text-muted-foreground",
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
                  t={t}
                />
                <NavRow
                  href={templatesHref}
                  label="Templates"
                  icon={FileText}
                  active={templatesActive}
                  collapsed={collapsed}
                  t={t}
                />
                <NavRow
                  href="/admin/flows"
                  label={t("flows")}
                  icon={Workflow}
                  active={pathname.startsWith('/admin/flows')}
                  collapsed={collapsed}
                  t={t}
                />
              </>
            ) : null}
            {!opsOnlyNav &&
              bottomNavItems.map((item) => (
                <NavRow
                  key={item.href}
                  href={item.href}
                  label={item.label ?? t(item.labelKey!)}
                  icon={item.icon}
                  active={pathname.startsWith(item.href)}
                  collapsed={collapsed}
                  t={t}
                />
              ))}
          </ul>
        </nav>

        {/* Profile + sign-out live in the top bar's account menu. */}
        {onToggleCollapsed ? (
          <div className="hidden shrink-0 border-t border-sidebar-border/70 p-3 lg:block">
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
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
          </div>
        ) : null}
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
  openInboxCount,
  t,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  totalUnread: number;
  openInboxCount: number;
  t: ReturnType<typeof useTranslations>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <p
        className={cn(
          "mb-1.5 px-3 text-xs font-medium text-muted-foreground",
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
          const isInbox = item.href === "/inbox";
          const showUnreadDot = isInbox && totalUnread > 0 && !isActive;
          return (
            <NavRow
              key={item.href}
              href={item.href}
              label={item.label ?? t(item.labelKey!)}
              icon={item.icon}
              active={isActive}
              collapsed={collapsed}
              beta={item.beta}
              unread={showUnreadDot ? totalUnread : 0}
              badge={isInbox ? openInboxCount : 0}
              t={t}
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
  badge = 0,
  t,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  collapsed: boolean;
  beta?: boolean;
  unread?: number;
  badge?: number;
  t: ReturnType<typeof useTranslations>;
}) {
  const badgeLabel =
    badge > 0 ? t("openContacts", { count: badge }) : undefined;
  const badgeText = String(badge);

  return (
    <li>
      <Link
        href={href}
        title={
          collapsed
            ? badgeLabel
              ? `${label} · ${badgeLabel}`
              : label
            : undefined
        }
        className={cn(
          "relative flex h-9 items-center gap-3 rounded-xl px-3 text-sm text-sidebar-foreground transition-colors duration-150",
          collapsed && "lg:justify-center lg:px-0",
          active
            ? "bg-sidebar-accent font-medium shadow-[0_1px_2px_rgb(0_0_0/0.04)]"
            : "font-normal hover:bg-sidebar-accent/60",
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            active ? "text-primary" : "text-sidebar-foreground/75",
          )}
        />
        <span className={cn("flex-1 truncate", collapsed && "lg:hidden")}>
          {label}
        </span>
        {beta ? (
          <span
            aria-label={t("beta")}
            className={cn(
              "rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-700 uppercase",
              collapsed && "lg:hidden",
            )}
          >
            {t("beta")}
          </span>
        ) : null}
        {badge > 0 ? (
          <span
            aria-label={badgeLabel}
            className={cn(
              "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums",
              collapsed &&
                "lg:absolute lg:top-1 lg:right-0.5 lg:h-3.5 lg:min-w-3.5 lg:px-0.5 lg:text-[8px]",
            )}
          >
            {badgeText}
          </span>
        ) : null}
        {unread > 0 ? (
          <span
            aria-label={t("unreadConversations", { count: unread })}
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
