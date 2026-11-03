'use client';

import { useEffect, useState } from 'react';
import { GraduationCap, Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  MAX_INSTRUCTION_LENGTH,
  type ReplyGuidance,
} from '@/lib/ai/reply-guidance';

/**
 * Corrections saved from "Train" on AI replies in the inbox. Active ones
 * are added to the AI agent's prompt for auto-replies, drafts and the
 * Playground.
 */
export function AgentReplyGuidance({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<ReplyGuidance[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ai/reply-guidance', { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load corrections.');
        setItems(data.guidance ?? []);
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
  }, []);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/reply-guidance/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not update.');
      setItems((prev) => prev.map((g) => (g.id === id ? data.guidance : g)));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update.');
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this correction? The agent will stop using it.'))
      return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/ai/reply-guidance/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Could not delete.');
      setItems((prev) => prev.filter((g) => g.id !== id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete.');
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (id: string) => {
    if (await patch(id, { instruction: draft })) setEditingId(null);
  };

  const active = items.filter((g) => g.is_active).length;

  return (
    <div className="space-y-4">
      <section className="border-border rounded-xl border p-5">
        <h3 className="flex items-center gap-2 font-medium">
          <GraduationCap className="text-primary h-4 w-4" />
          Reply corrections
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Hover over an AI reply in the inbox and choose <strong>Train</strong>{' '}
          to tell the agent how to answer similar messages. Active corrections
          apply to automatic replies, drafts and the Playground straight away;
          for each message the agent uses the ones closest to what the customer
          wrote.
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          {active} active · {items.length} total
        </p>
      </section>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="text-primary h-5 w-5 animate-spin" />
        </div>
      ) : failed ? null : items.length === 0 ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
          No corrections yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((g) => {
            const busy = busyId === g.id;
            const editing = editingId === g.id;
            return (
              <li
                key={g.id}
                className="border-border space-y-3 rounded-xl border p-4 text-sm"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      Customer wrote
                    </p>
                    <p className="bg-muted line-clamp-4 whitespace-pre-wrap rounded-md px-3 py-2">
                      {g.customer_message || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-medium">
                      AI replied
                    </p>
                    <p className="bg-muted line-clamp-4 whitespace-pre-wrap rounded-md px-3 py-2">
                      {g.ai_reply || '—'}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1 text-xs font-medium">
                    Respond this way next time
                  </p>
                  {editing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={MAX_INSTRUCTION_LENGTH}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !draft.trim()}
                          onClick={() => void saveEdit(g.id)}
                        >
                          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{g.instruction}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">
                    {new Date(g.created_at).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={g.is_active}
                        disabled={!canEdit || busy}
                        onCheckedChange={(checked) =>
                          void patch(g.id, { is_active: checked })
                        }
                      />
                      {g.is_active ? 'Active' : 'Off'}
                    </label>
                    {canEdit && !editing && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(g.id);
                            setDraft(g.instruction);
                          }}
                          aria-label="Edit correction"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void remove(g.id)}
                          aria-label="Delete correction"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
