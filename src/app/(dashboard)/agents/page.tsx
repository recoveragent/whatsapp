'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Sparkles, Settings2, BarChart3 } from 'lucide-react';
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

type Tab = 'playground' | 'train' | 'setup' | 'usage';

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
  const [tab, setTab] = useState<Tab>('playground');
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
      router.replace('/dashboard');
    }
  }, [profileLoading, isAiAgentsEnabled, router]);

  // Land first-time users on training, returning users on the Playground.
  useEffect(() => {
    if (!isAiAgentsEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setTab(data?.configured ? 'playground' : 'train');
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
              onNavigate={changeTab}
            />
          )}
          {isShopifyBrand && (introductory || tab === 'setup') && (
            <div className="mt-6">
              <AgentOnboarding
                key={accountId}
                canEdit={canViewUsage}
                introductory={introductory}
                onGetStarted={() => {
                  setIntroductory(false);
                  changeTab('train');
                }}
              />
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => changeTab(v as Tab)}
            className="mt-6"
          >
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="train">
                <Bot className="mr-1.5 h-4 w-4" /> Train Agent
              </TabsTrigger>
              <TabsTrigger value="playground">
                <Sparkles className="mr-1.5 h-4 w-4" /> Playground
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

            <TabsContent value="train" className="mt-4">
              <AgentTraining key={accountId} canEdit={canViewUsage} />
            </TabsContent>

            <TabsContent value="playground" className="mt-4">
              <AiPlayground onGoToSetup={() => changeTab('setup')} />
            </TabsContent>

            <TabsContent value="setup" className="mt-4">
              <AiConfig />
            </TabsContent>

            {canViewUsage && (
              <TabsContent value="usage" className="mt-4">
                <AiUsageCard />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
