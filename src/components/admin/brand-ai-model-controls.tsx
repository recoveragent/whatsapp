'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';

export function BrandAiModelControls({ brandId }: { brandId: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [hasEmbeddingsKey, setHasEmbeddingsKey] = useState(false);
  const [clearEmbeddings, setClearEmbeddings] = useState(false);
  const [retry, setRetry] = useState(0);
  const endpoint = `/api/admin/brands/${brandId}/ai`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(endpoint, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load AI model');
        if (controller.signal.aborted) return;
        setConfigured(data.configured);
        if (data.configured) {
          setProvider(data.provider);
          setModel(data.model);
        }
        setHasKey(!!data.has_key);
        setHasEmbeddingsKey(!!data.has_embeddings_key);
        setFailed(false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          toast.error(err.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, retry]);

  const submit = async (testOnly: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: apiKey.trim() || undefined,
          embeddings_api_key: clearEmbeddings
            ? null
            : embeddingsKey.trim() || undefined,
          test_only: testOnly,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save AI model');
      toast.success(
        testOnly
          ? 'AI credentials tested successfully'
          : 'AI model saved for this brand'
      );
      if (!testOnly) {
        setApiKey('');
        setEmbeddingsKey('');
        setClearEmbeddings(false);
        setRetry((value) => value + 1);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save AI model'
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !confirm(
        'Remove this brand’s AI model and disable AI replies? Its knowledge documents will be kept.'
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove AI model');
      setConfigured(false);
      setHasKey(false);
      setHasEmbeddingsKey(false);
      setApiKey('');
      setEmbeddingsKey('');
      setClearEmbeddings(false);
      toast.success('AI model removed. Replies are disabled for this brand.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not remove AI model'
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading AI model…
      </p>
    );
  if (failed)
    return (
      <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
        Retry AI model settings
      </Button>
    );
  return (
    <section className="border-border bg-muted/20 rounded-xl border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="text-primary h-4 w-4" /> WhatsApp AI model
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">
        Only super admin can change the provider, model and API keys. Brand
        admins manage prompts, knowledge and reply behavior.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`ai-provider-${brandId}`}>Provider</Label>
          <select
            id={`ai-provider-${brandId}`}
            value={provider}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as AiProvider;
              setProvider(next);
              setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
              setApiKey('');
            }}
            className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`ai-model-${brandId}`}>Model ID</Label>
          <Input
            id={`ai-model-${brandId}`}
            value={model}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`ai-key-${brandId}`}>Provider API key</Label>
          <Input
            id={`ai-key-${brandId}`}
            type="password"
            autoComplete="new-password"
            value={apiKey}
            disabled={busy}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              hasKey
                ? 'Stored securely — leave blank to keep'
                : 'Enter an API key'
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`ai-embeddings-${brandId}`}>
            Embeddings API key (optional)
          </Label>
          <Input
            id={`ai-embeddings-${brandId}`}
            type="password"
            autoComplete="new-password"
            value={embeddingsKey}
            disabled={busy || clearEmbeddings}
            onChange={(event) => setEmbeddingsKey(event.target.value)}
            placeholder={
              hasEmbeddingsKey
                ? 'Stored securely — leave blank to keep'
                : 'OpenAI embeddings key'
            }
          />
          {hasEmbeddingsKey && (
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={clearEmbeddings}
                disabled={busy}
                onChange={(event) => setClearEmbeddings(event.target.checked)}
              />{' '}
              Remove embeddings key on save
            </label>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy || !model.trim()}
          onClick={() => void submit(false)}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save AI
          model
        </Button>
        <Button
          variant="outline"
          disabled={busy || !model.trim()}
          onClick={() => void submit(true)}
        >
          Test credentials
        </Button>
        {configured && (
          <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
            Remove model
          </Button>
        )}
      </div>
      {!configured && (
        <p className="text-muted-foreground mt-3 text-xs">
          New configurations start with automatic replies off. The brand admin
          can enable them after testing.
        </p>
      )}
    </section>
  );
}
