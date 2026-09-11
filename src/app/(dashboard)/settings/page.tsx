'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { PageHeader } from '@/components/layout/page-header';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppBrandConnection } from '@/components/settings/whatsapp-brand-connection';
import { ShopifyBrandConnection } from '@/components/settings/shopify-brand-connection';
import { WooCommerceBrandConnection } from '@/components/settings/woocommerce-brand-connection';
import { GoogleSheetsBrandConnection } from '@/components/settings/google-sheets-brand-connection';
import { LeadCadencesSettings } from '@/components/settings/lead-cadences-settings';
import { TemplateManager } from '@/components/settings/template-manager';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { InboxFollowupSettings } from '@/components/settings/inbox-followup-settings';
import { InboxMagicMessageSettings } from '@/components/settings/inbox-magic-message-settings';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import {
  resolveSection,
  isSettingsSectionVisible,
  type SettingsSection,
} from '@/components/settings/settings-sections';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, brandCategory, ecommercePlatform } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  const section = resolveSection(searchParams.get('tab'));
  const activeSection = useMemo(() => {
    if (!isSettingsSectionVisible(section, brandCategory, ecommercePlatform)) {
      return 'overview' as SettingsSection;
    }
    return section;
  }, [section, brandCategory, ecommercePlatform]);

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
    woocommerce: <WooCommerceBrandConnection />,
    google_sheets: <GoogleSheetsBrandConnection />,
    cadences: <LeadCadencesSettings />,
    templates: <TemplateManager />,
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: (
      <>
        <InboxMagicMessageSettings />
        <InboxFollowupSettings />
      </>
    ),
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div>
      <PageHeader
        size="admin"
        eyebrow="Admin"
        title={t('pageTitle')}
        subtitle={t('pageDesc')}
      />

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
