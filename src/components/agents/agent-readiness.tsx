'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle, Loader2, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  buildReadinessChecks,
  isAgentLive,
  type ReadinessAction,
  type ReadinessCheck,
  type ReadinessFacts,
} from '@/lib/ai/readiness';

/** Set by the Playground after a successful test reply. */
export function playgroundTestedKey(accountId: string | null | undefined) {
  return `ai-playground-tested:${accountId ?? 'none'}`;
}

function readPlaygroundTested(accountId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(playgroundTestedKey(accountId)) === '1';
  } catch {
    return false;
  }
}

const LINKS: Partial<Record<ReadinessAction, string>> = {
  whatsapp_settings: '/settings?tab=whatsapp',
  shopify_settings: '/settings?tab=shopify',
  automations: '/automations',
};

/**
 * Go-live checklist at the top of AI Agents. Shows what is still needed
 * before the agent can answer customers on its own, with a jump to the
 * place that fixes each item. `refreshKey` lets the page re-check after
 * the user saves settings in another tab.
 */
export function AgentReadiness({
  accountId,
  refreshKey,
  onNavigate,
}: {
  accountId: string | null | undefined;
  refreshKey: number;
  onNavigate: (tab: 'train' | 'setup' | 'playground') => void;
}) {
  const [checks, setChecks] = useState<ReadinessCheck[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch('/api/ai/readiness', { signal });
        if (!res.ok) throw new Error('readiness');
        const facts = (await res.json()) as ReadinessFacts;
        if (signal?.aborted) return;
        setChecks(
          buildReadinessChecks({
            ...facts,
            playgroundTested: readPlaygroundTested(accountId),
          })
        );
        setFailed(false);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [accountId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  if (failed || !checks) {
    return failed ? null : (
      <div className="text-muted-foreground mt-6 flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking go-live status…
      </div>
    );
  }

  const live = isAgentLive(checks);
  const done = checks.filter((c) => c.done).length;

  return (
    <section className="border-border bg-card mt-6 rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
            {live ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                Your AI agent is live on WhatsApp
              </>
            ) : (
              <>
                <Radio className="text-primary h-4 w-4" /> Go-live checklist
              </>
            )}
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {done} of {checks.length} done
            {live && done < checks.length ? ' · optional steps improve answers' : ''}
          </p>
        </div>
        <div className="bg-muted h-1.5 w-40 overflow-hidden rounded-full">
          <div
            className={cn('h-full rounded-full', live ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${Math.round((done / checks.length) * 100)}%` }}
          />
        </div>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <li
            key={check.id}
            className={cn(
              'border-border flex items-start gap-3 rounded-xl border p-3',
              check.done && 'bg-muted/30'
            )}
          >
            {check.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  check.required ? 'text-amber-500' : 'text-muted-foreground'
                )}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-medium">
                {check.label}
                {!check.done && !check.required && (
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    Recommended
                  </span>
                )}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">{check.detail}</p>
            </div>
            {!check.done && <CheckAction check={check} onNavigate={onNavigate} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckAction({
  check,
  onNavigate,
}: {
  check: ReadinessCheck;
  onNavigate: (tab: 'train' | 'setup' | 'playground') => void;
}) {
  if (check.action === 'super_admin') return null;
  const href = LINKS[check.action];
  if (href) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        render={<Link href={href} />}
        nativeButton={false}
      >
        Fix <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      className="shrink-0"
      onClick={() => onNavigate(check.action as 'train' | 'setup' | 'playground')}
    >
      Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}
