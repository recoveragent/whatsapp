'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppBrandConnection } from '@/components/settings/whatsapp-brand-connection';
import { ShopifyBrandConnection } from '@/components/settings/shopify-brand-connection';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { InboxFollowupSettings } from '@/components/settings/inbox-followup-settings';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  isSettingsSectionVisible,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, brandCategory } = useAuth();
  const { mode } = useTheme();

  const section = resolveSection(searchParams.get('tab'));
  const activeSection = useMemo(() => {
    if (!isSettingsSectionVisible(section, brandCategory)) {
      return 'overview' as SettingsSection;
    }
    return section;
  }, [section, brandCategory]);

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppBrandConnection />,
    shopify: <ShopifyBrandConnection />,
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: <InboxFollowupSettings />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything in one place — your account and your workspace. Pick a
          section to manage it.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        {/* z-10 keeps the sticky rail above panel stacking contexts so
            overflows / animated panels can't steal its clicks. */}
        <div className="relative z-10 min-w-0">
          <SettingsRail active={activeSection} onSelect={go} hints={hints} />
        </div>
        {/* Clip horizontal overflow so wide panel children can't extend
            into the rail column and intercept pointer events. */}
        <div className="relative z-0 min-w-0 overflow-x-clip">
          {panel[activeSection]}
        </div>
      </div>
    </div>
  );
}
