'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { TrainingFaq, TrainingSet } from '@/lib/ai/training-types';

export function AgentTraining({ canEdit }: { canEdit: boolean }) {
  const [training, setTraining] = useState<TrainingSet | null>(null);
  const [faqs, setFaqs] = useState<TrainingFaq[]>([]);
  const [website, setWebsite] = useState('');
  const [connectedUrl, setConnectedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<
    'scan' | 'save' | 'publish' | 'unpublish' | null
  >(null);
  const [dirty, setDirty] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ai/training', { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load training.');
        setTraining(data.training);
        setFaqs(data.training?.faqs ?? []);
        setConnectedUrl(data.connected_url ?? '');
        setWebsite(data.training?.website_url || data.connected_url || '');
        setFailed(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          toast.error(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  const accept = (value: TrainingSet) => {
    setTraining(value);
    setFaqs(value.faqs);
    setDirty(false);
  };
  const saveDraft = async () => {
    const res = await fetch('/api/ai/training', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: training?.revision, faqs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Could not save training.');
    accept(data.training);
    return data.training as TrainingSet;
  };
  const run = async (action: 'scan' | 'save' | 'publish' | 'unpublish') => {
    setBusy(action);
    try {
      if (action === 'scan') {
        // Preserve unsaved merchant work before a new scan; live knowledge is unchanged.
        const current = dirty ? await saveDraft() : training;
        const res = await fetch('/api/ai/training', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            website_url: website.trim(),
            revision: current?.revision ?? 0,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not scan website.');
        accept(data.training);
        setWebsite(data.training.website_url);
        setWarnings(data.warnings ?? []);
        toast.success(
          'Questions generated. Review the source-backed answers and fill the blanks.'
        );
      } else if (action === 'save') {
        await saveDraft();
        toast.success('Draft saved. Live agent knowledge has not changed.');
      } else {
        const current = dirty ? await saveDraft() : training;
        const res = await fetch('/api/ai/training/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            revision: current?.revision,
            unpublish: action === 'unpublish',
          }),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error ?? 'Could not publish training.');
        if (current)
          setTraining({
            ...current,
            published_revision:
              action === 'unpublish' ? null : current.revision,
            published_at:
              action === 'unpublish' ? null : new Date().toISOString(),
          });
        toast.success(
          action === 'unpublish'
            ? 'Published FAQ withdrawn. Your training draft is kept.'
            : 'Approved answers published to the agent’s knowledge base.'
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Training failed.');
    } finally {
      setBusy(null);
    }
  };
  const update = (id: string, patch: Partial<TrainingFaq>) => {
    setFaqs((previous) =>
      previous.map((faq) =>
        faq.id === id
          ? {
              ...faq,
              ...patch,
              ...(patch.question !== undefined || patch.answer !== undefined
                ? { approved: false, merchantEdited: true }
                : {}),
            }
          : faq
      )
    );
    setDirty(true);
  };
  const disabled = !canEdit || !!busy;
  const answered = faqs.filter((faq) => faq.answer.trim()).length;
  const approved = faqs.filter(
    (faq) => faq.approved && faq.answer.trim()
  ).length;
  if (loading)
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading agent training…
      </p>
    );
  if (failed)
    return (
      <div className="space-y-3">
        <p>
          Could not load training. Check that the latest database migration is
          installed.
        </p>
        <Button
          onClick={() => {
            setLoading(true);
            setRetry((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  return (
    <div className="space-y-6">
      <section className="border-border space-y-4 rounded-xl border p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="text-primary h-5 w-5" /> Train Agent
        </h2>
        <p className="text-muted-foreground text-sm">
          Use your website to discover questions your customers may ask. Answers
          are copied from the pages we can read, with a source for review. If an
          answer is unavailable, it stays blank for your team to complete.
        </p>
        {!canEdit && (
          <p className="text-muted-foreground text-sm">
            Brand admins can scan, edit and publish training.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="training-website">Brand website URL</Label>
          <Input
            id="training-website"
            type="url"
            value={website}
            disabled={disabled}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://your-store.com"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {connectedUrl && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => setWebsite(connectedUrl)}
            >
              Use connected store URL
            </Button>
          )}
          <Button
            disabled={disabled || !website.trim()}
            onClick={() => void run('scan')}
          >
            {busy === 'scan' && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {training
              ? 'Rescan website & refresh questions'
              : 'Scan website & generate questions'}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Scans up to six linked public pages, prioritizing policies and FAQs.
          Password-protected or JavaScript-only pages may be unavailable.
          Scanning uses your configured AI model and may take about a minute.
          Merchant edits are kept; refreshed answers need approval again.
        </p>
        {warnings.length > 0 && (
          <ul className="text-muted-foreground list-inside list-disc text-xs">
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        )}
      </section>
      {training && (
        <>
          <section className="border-border rounded-xl border p-5">
            <h3 className="font-medium">
              Website sources ({training.sources.length})
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {training.sources.map((source) => (
                <li key={source.id}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {source.title || source.url}
                  </a>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {new Date(source.fetchedAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Review customer questions</h3>
              <p className="text-muted-foreground text-sm">
                {faqs.length} questions · {answered} answered ·{' '}
                {faqs.length - answered} need your answer · {approved} approved
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyUnanswered}
                onChange={(event) => setOnlyUnanswered(event.target.checked)}
              />{' '}
              Show unanswered only
            </label>
          </div>
          <div className="space-y-4">
            {faqs
              .filter(
                (faq) =>
                  !onlyUnanswered ||
                  !training.faqs
                    .find((saved) => saved.id === faq.id)
                    ?.answer.trim()
              )
              .map((faq) => {
                const source = training.sources.find(
                  (source) => source.id === faq.sourceId
                );
                return (
                  <section
                    key={faq.id}
                    className="border-border space-y-3 rounded-xl border p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {faq.merchantEdited
                          ? 'Merchant supplied / edited'
                          : faq.answer
                            ? 'Website excerpt — review required'
                            : 'No supported answer — your input needed'}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          setFaqs((previous) =>
                            previous.filter((row) => row.id !== faq.id)
                          );
                          setDirty(true);
                        }}
                      >
                        Remove question
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`question-${faq.id}`}>
                        Customer question
                      </Label>
                      <Input
                        id={`question-${faq.id}`}
                        value={faq.question}
                        maxLength={250}
                        disabled={disabled}
                        onChange={(event) =>
                          update(faq.id, { question: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`answer-${faq.id}`}>Answer</Label>
                      <Textarea
                        id={`answer-${faq.id}`}
                        rows={4}
                        value={faq.answer}
                        maxLength={3000}
                        disabled={disabled}
                        onChange={(event) =>
                          update(faq.id, { answer: event.target.value })
                        }
                        placeholder="No answer found on the website. Enter your brand’s answer here."
                      />
                    </div>
                    {source && (
                      <details className="text-muted-foreground text-xs">
                        <summary className="cursor-pointer">
                          View website evidence
                        </summary>
                        <a
                          className="text-primary mt-2 block underline"
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.url}
                        </a>
                        <p className="mt-2 whitespace-pre-wrap">
                          {faq.topicQuote}
                        </p>
                        {faq.generatedAnswer && (
                          <blockquote className="border-border mt-2 border-l-2 pl-3">
                            {faq.generatedAnswer}
                          </blockquote>
                        )}
                      </details>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={disabled || !faq.answer.trim()}
                        checked={faq.approved}
                        onChange={(event) =>
                          update(faq.id, { approved: event.target.checked })
                        }
                      />{' '}
                      I reviewed this answer and approve it for the agent
                    </label>
                  </section>
                );
              })}
          </div>
          <Button
            variant="outline"
            disabled={disabled || faqs.length >= 100}
            onClick={() => {
              setFaqs((previous) => [
                ...previous,
                {
                  id: crypto.randomUUID(),
                  question: '',
                  answer: '',
                  sourceId: null,
                  topicQuote: '',
                  generatedAnswer: '',
                  merchantEdited: true,
                  approved: false,
                },
              ]);
              setDirty(true);
              setOnlyUnanswered(false);
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Add your own question
          </Button>
          <section className="border-border bg-background sticky bottom-0 space-y-3 rounded-xl border p-4 shadow-sm">
            <p className="text-muted-foreground text-sm">
              Blank and unapproved answers are never published. Publishing
              replaces only this training section’s live FAQ document, with one
              question and answer per search entry. Other knowledge documents
              stay in place.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={disabled || !dirty}
                onClick={() => void run('save')}
              >
                {busy === 'save' && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save draft
              </Button>
              <Button
                disabled={disabled || !approved}
                onClick={() => void run('publish')}
              >
                {busy === 'publish' && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Publish {approved} approved answers
              </Button>
              {training.published_at && (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void run('unpublish')}
                >
                  Withdraw published FAQ
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {dirty
                ? 'Unsaved changes.'
                : training.published_revision === training.revision
                  ? 'This revision is published.'
                  : 'Draft changes are not live.'}{' '}
              Published FAQs are immediately searchable by keyword. For semantic
              search, use Reindex in Setup → Knowledge after publishing.
              Publishing does not enable automatic replies.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
