'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface StoreReadiness {
  connected: boolean;
  shop_domain?: string;
  product_count?: number | null;
  policies_imported_at?: string | null;
  carousel_enabled?: boolean;
}

export function AgentOnboarding({
  canEdit,
  onGetStarted,
  introductory = false,
}: {
  canEdit: boolean;
  onGetStarted: () => void;
  introductory?: boolean;
}) {
  const [store, setStore] = useState<StoreReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [training, setTraining] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/ai/storefront', { signal });
      if (!res.ok) throw new Error('Unable to load store');
      const data = await res.json();
      if (signal?.aborted) return;
      setStore(data);
      setFailed(false);
    } catch {
      if (!signal?.aborted) setFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const train = async () => {
    setTraining(true);
    try {
      const res = await fetch('/api/ai/storefront', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not import policies');
      toast.success(
        data.warning ?? 'Store policies imported. Test them in the playground.'
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not import policies'
      );
    } finally {
      setTraining(false);
    }
  };

  return (
    <section className="border-border bg-card mb-6 max-w-2xl rounded-2xl border p-6 sm:p-8">
      <span className="border-primary/20 bg-primary/5 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
        <Bot className="h-3.5 w-3.5" /> AI AGENT
      </span>
      <h2 className="text-foreground mt-4 text-3xl font-semibold tracking-tight">
        Automate support
        <br />
        and drive more sales
      </h2>
      <p className="text-muted-foreground mt-3 max-w-lg text-sm leading-6">
        Help customers find products, check their orders, and get answers around
        the clock. Train your agent, test its replies, then turn it on for
        WhatsApp.
      </p>
      <div className="border-border bg-muted/40 mt-6 flex items-center gap-3 rounded-xl border p-4">
        <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-600">
          <ShoppingBag className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">
            {store?.shop_domain?.replace('.myshopify.com', '') ??
              'Your Shopify store'}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {store?.shop_domain ??
              (loading
                ? 'Checking connection…'
                : failed
                  ? 'Connection status unavailable'
                  : 'Connect a store to get started')}
          </p>
        </div>
        {store?.connected && (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600">
            Connected
          </span>
        )}
      </div>
      {introductory && (
        <div className="mt-5">
          <Button
            className="w-full"
            disabled={training || loading}
            onClick={async () => {
              if (store?.connected && canEdit) await train();
              onGetStarted();
            }}
          >
            {training ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing
                store policies…
              </>
            ) : (
              <>
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Get started imports published store policies when connected. Your
            super admin configures the AI model; test replies before enabling
            WhatsApp.
          </p>
        </div>
      )}
      <ul className="text-foreground mt-6 space-y-3 text-sm">
        {[
          'Product recommendations and guided selling',
          'Order status and verified lookups',
          'Import store policies without copying them by hand',
          'Hand off to your team when needed',
        ].map((label) => (
          <li key={label} className="flex items-center gap-3">
            <CheckCircle2 className="text-primary h-4 w-4 shrink-0" />
            {label}
          </li>
        ))}
      </ul>
      {!introductory && (
        <div className="border-border mt-6 space-y-3 border-t pt-5">
          <p className="text-muted-foreground text-sm">
            {store?.policies_imported_at
              ? `Policies imported ${new Date(store.policies_imported_at).toLocaleDateString()}. Retrain after changing them in Shopify.`
              : 'Import your published Shopify policies so the agent can answer shipping, return, and refund questions.'}
          </p>
          <p className="text-muted-foreground text-xs">
            {store?.product_count == null
              ? 'Catalog status unavailable.'
              : `${store.product_count} active catalog variants synced.`}{' '}
            {store?.carousel_enabled
              ? 'WhatsApp product carousels enabled.'
              : 'Enable Sell on WhatsApp in store settings for product carousels.'}
          </p>
          <p className="text-muted-foreground text-xs">
            Retraining replaces the imported policy document. Add your own FAQs
            as separate Knowledge entries.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canEdit || !store?.connected || training || loading}
              onClick={train}
            >
              {training ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {training
                ? 'Importing policies…'
                : store?.policies_imported_at
                  ? 'Retrain store policies'
                  : 'Import store policies'}
            </Button>
            <Button
              variant="ghost"
              render={<Link href="/settings?tab=shopify" />}
              nativeButton={false}
            >
              Store settings <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
            {failed && (
              <Button variant="ghost" onClick={() => void load()}>
                Retry connection check
              </Button>
            )}
          </div>
          {!canEdit && (
            <p className="text-muted-foreground text-xs">
              Ask an admin to import store policies and configure the agent.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
