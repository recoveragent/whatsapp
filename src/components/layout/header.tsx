"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, Menu, Settings as SettingsIcon, User } from "lucide-react";
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
import { SystemNotifications } from "@/components/layout/system-notifications";
import { ReminderNotifications } from "@/components/layout/reminder-notifications";
import { TopBarSlotTarget } from "@/components/layout/top-bar-slots";
import { BRAND_ICON_PATH, BRAND_NAME } from "@/components/brand/brand-logo";
import { useTranslations } from "next-intl";

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const { profile, signOut } = useAuth();

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="app-topbar z-20 flex h-14 shrink-0 items-center justify-between gap-3 bg-frame px-3 text-frame-foreground lg:h-16 lg:px-5">
      {/* lg width lines the page slot up with the sidebar's right edge. */}
      <div className="flex min-w-0 items-center gap-2 lg:w-[236px] lg:shrink-0">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
          <Image
            src={BRAND_ICON_PATH}
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-lg"
            priority
          />
          <span className="truncate text-sm font-bold text-foreground">
            {BRAND_NAME}
          </span>
        </Link>
      </div>

      {/* Page slots line up with the columns below: start over a page's
          list column (w-80), center over its main pane. */}
      <TopBarSlotTarget slot="start" className="lg:w-80 lg:shrink-0 lg:pr-3" />
      <TopBarSlotTarget slot="center" className="flex-1" />

      <div className="flex items-center gap-1 sm:gap-2">
        <SystemNotifications />
        <ReminderNotifications />

        <DropdownMenu>
        <DropdownMenuTrigger
          className="flex items-center gap-2 rounded-full px-1 py-1 transition-colors hover:bg-accent focus:bg-accent focus:outline-none data-popup-open:bg-accent sm:gap-2.5 sm:pl-1 sm:pr-3"
          aria-label={t("openAccountMenu")}
        >
          <Avatar className="size-8">
            {profile?.avatar_url ? (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile.full_name ?? t("defaultAvatar")}
              />
            ) : null}
            <AvatarFallback className="bg-primary text-sm font-medium text-primary-foreground">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium text-foreground sm:inline">
            {profile?.full_name ?? t("defaultUser")}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-56 bg-popover text-popover-foreground ring-border"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {profile?.full_name ?? t("defaultUser")}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? ""}
            </p>
          </div>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=profile"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <User className="size-4" />
            {t("menuProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            render={
              <Link
                href="/settings?tab=whatsapp"
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              />
            }
          >
            <SettingsIcon className="size-4" />
            {t("menuSettings")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            onClick={signOut}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut className="size-4" />
            {t("menuSignOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
