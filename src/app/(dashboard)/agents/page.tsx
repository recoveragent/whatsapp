'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Sparkles, Settings2, BarChart3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { AgentOnboarding } from '@/components/agents/agent-onboarding';
import { AgentTraining } from '@/components/agents/agent-training';

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
      {/* Sidebar already names the page; keep the heading for screen readers. */}
      <h1 className="sr-only">AI Agents</h1>
      <p className="text-muted-foreground text-sm">
        Your AI model is managed by super admin. Configure your agent’s behavior
        and knowledge, then test replies in the playground before going live.
      </p>

      {decided && (
        <>
          {isShopifyBrand && (introductory || tab === 'setup') && (
            <div className="mt-6">
              <AgentOnboarding
                key={accountId}
                canEdit={canViewUsage}
                introductory={introductory}
                onGetStarted={() => {
                  setIntroductory(false);
                  setTab('train');
                }}
              />
            </div>
          )}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
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
              <AiPlayground onGoToSetup={() => setTab('setup')} />
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
