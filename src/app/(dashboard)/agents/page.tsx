'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Settings2,
  BarChart3,
  GraduationCap,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { AgentOnboarding } from '@/components/agents/agent-onboarding';
import { AgentTraining } from '@/components/agents/agent-training';
import { AgentReadiness } from '@/components/agents/agent-readiness';
import { AgentReplyGuidance } from '@/components/agents/agent-reply-guidance';

type Tab = 'train' | 'corrections' | 'setup' | 'usage';

export default function AgentsPage() {
  const router = useRouter();
  const {
    accountRole,
    accountId,
    isShopifyBrand,
    isAiAgentsEnabled,
    profileLoading,
  } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('train');
  const playgroundRef = useRef<HTMLElement>(null);
  const [decided, setDecided] = useState(false);
  const [introductory, setIntroductory] = useState(false);
  // Bumped on tab changes so the checklist reflects what was just saved.
  const [readinessKey, setReadinessKey] = useState(0);
  const changeTab = (next: Tab) => {
    setTab(next);
    setReadinessKey((k) => k + 1);
  };

  useEffect(() => {
    if (!profileLoading && !isAiAgentsEnabled) {
      router.replace('/inbox');
    }
  }, [profileLoading, isAiAgentsEnabled, router]);

  // Show onboarding for agents that have not been configured yet.
  useEffect(() => {
    if (!isAiAgentsEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setIntroductory(!data?.configured);
        }
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAiAgentsEnabled, accountId]);

  if (profileLoading || !isAiAgentsEnabled) {
    return null;
  }

  return (
    <div>
      <PageHeader
        title="AI Agents"
        subtitle="Answers product, policy and order questions on WhatsApp around the clock, and hands the chat to your team when it should. Train it, test it, then switch it on."
      />

      {decided && (
        <>
          {!introductory && (
            <AgentReadiness
              accountId={accountId}
              refreshKey={readinessKey}
              onNavigate={(next) => {
                if (next === 'playground') {
                  playgroundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  playgroundRef.current?.focus({ preventScroll: true });
                } else {
                  changeTab(next);
                }
              }}
            />
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => changeTab(v as Tab)}
            className="mt-6"
          >
            <div className="bg-background sticky top-0 z-20 -mx-2 px-2 py-2">
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="train">
                  <Bot className="mr-1.5 h-4 w-4" /> Train Agent
                </TabsTrigger>
                <TabsTrigger value="corrections">
                  <GraduationCap className="mr-1.5 h-4 w-4" /> Reply Corrections
                </TabsTrigger>
                <TabsTrigger value="setup">
                  <Settings2 className="mr-1.5 h-4 w-4" /> Setup
                </TabsTrigger>
                {canViewUsage && (
                  <TabsTrigger value="usage">
                    <BarChart3 className="mr-1.5 h-4 w-4" /> Usage
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
              <div className="min-w-0">
                <TabsContent value="train" className="mt-4">
                  {isShopifyBrand && introductory && (
                    <AgentOnboarding
                      key={accountId}
                      canEdit={canViewUsage}
                      introductory
                      onGetStarted={() => {
                        setIntroductory(false);
                        changeTab('train');
                      }}
                    />
                  )}
                  <AgentTraining key={accountId} canEdit={canViewUsage} />
                </TabsContent>

                <TabsContent value="corrections" className="mt-4">
                  <AgentReplyGuidance key={accountId} canEdit={canViewUsage} />
                </TabsContent>

                <TabsContent value="setup" className="mt-4">
                  {isShopifyBrand && (
                    <AgentOnboarding
                      key={accountId}
                      canEdit={canViewUsage}
                      onGetStarted={() => changeTab('train')}
                    />
                  )}
                  <AiConfig />
                </TabsContent>

                {canViewUsage && (
                  <TabsContent value="usage" className="mt-4">
                    <AiUsageCard />
                  </TabsContent>
                )}
              </div>
              <aside
                ref={playgroundRef}
                tabIndex={-1}
                className="min-w-0 lg:sticky lg:top-16"
                aria-label="Customer mobile playground preview"
              >
                <AiPlayground
                  onGoToSetup={() => changeTab('setup')}
                  onTested={() => setReadinessKey((k) => k + 1)}
                />
              </aside>
            </div>
          </Tabs>
        </>
      )}
    </div>
  );
}
