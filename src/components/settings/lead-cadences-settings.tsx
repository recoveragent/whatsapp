'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { createClient } from '@/lib/supabase/client';
import type { Cadence, CadenceChannel, CadenceStep } from '@/lib/leads/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { MetaConversionsPanel } from './meta-conversions-panel';

interface EditableStep {
  delay_hours: string;
  channel: CadenceChannel;
  template_name: string;
  script_en: string;
  script_hi: string;
}

function stepsFromCadence(cadence: Cadence): EditableStep[] {
  return (cadence.steps ?? []).map((s: CadenceStep) => ({
    delay_hours: String(s.delay_minutes / 60),
    channel: s.channel,
    template_name: s.template_name ?? '',
    script_en: s.script_en ?? '',
    script_hi: s.script_hi ?? '',
  }));
}

export function LeadCadencesSettings() {
  const canEdit = useCan('edit-settings');
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditableStep[]>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads/cadences', { cache: 'no-store' });
      const data = (await res.json()) as { cadences?: Cadence[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load cadences');
      const list = data.cadences ?? [];
      setCadences(list);
      const nextDrafts: Record<string, EditableStep[]> = {};
      const nextNames: Record<string, string> = {};
      for (const c of list) {
        nextDrafts[c.id] = stepsFromCadence(c);
        nextNames[c.id] = c.name;
      }
      setDrafts(nextDrafts);
      setNames(nextNames);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load cadences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    void supabase
      .from('message_templates')
      .select('name, status')
      .eq('account_id', accountId)
      .eq('status', 'APPROVED')
      .then(({ data }) => {
        const names = [...new Set((data ?? []).map((r) => r.name as string))].sort();
        setTemplates(names);
      });
  }, [accountId]);

  async function save(cadence: Cadence) {
    if (!canEdit) return;
    const steps = drafts[cadence.id] ?? [];
    setSavingId(cadence.id);
    try {
      const res = await fetch(`/api/leads/cadences/${cadence.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: names[cadence.id]?.trim() || cadence.name,
          steps: steps.map((s) => ({
            delay_minutes: Math.max(0, Math.round(Number(s.delay_hours || 0) * 60)),
            channel: s.channel,
            template_name: s.template_name || null,
            script_en: s.script_en || null,
            script_hi: s.script_hi || null,
          })),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      toast.success('Cadence saved');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingId(null);
    }
  }

  function patchStep(cadenceId: string, index: number, patch: Partial<EditableStep>) {
    setDrafts((prev) => {
      const list = [...(prev[cadenceId] ?? [])];
      const current = list[index];
      if (!current) return prev;
      list[index] = { ...current, ...patch };
      return { ...prev, [cadenceId]: list };
    });
  }

  return (
    <div className="space-y-8">
      <MetaConversionsPanel />
      <div>
      <SettingsPanelHead
        title="Lead cadences"
        description="Timed follow-up for Instant Form leads who never message first. Auto-send WhatsApp templates; call steps land in the Leads queue. Pick approved templates or those steps wait."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading cadences…
        </div>
      ) : (
        <div className="space-y-6">
          {cadences.map((cadence) => {
            const steps = drafts[cadence.id] ?? [];
            const missingTemplate = steps.some(
              (s) => s.channel === 'wa_template' && !s.template_name,
            );
            return (
              <div key={cadence.id} className="space-y-3 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[12rem] flex-1">
                    <Label className="text-xs">Cadence name</Label>
                    <Input
                      className="mt-1"
                      value={names[cadence.id] ?? cadence.name}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setNames((p) => ({ ...p, [cadence.id]: e.target.value }))
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Expires after {cadence.expire_after_days} days · calls{' '}
                    {String(cadence.call_hours_start).slice(0, 5)}–
                    {String(cadence.call_hours_end).slice(0, 5)} IST Mon–Sat
                  </p>
                </div>
                {missingTemplate && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    WhatsApp steps need an approved template or they will not send.
                  </p>
                )}
                <div className="space-y-3">
                  {steps.map((step, index) => (
                    <div
                      key={`${cadence.id}-${index}`}
                      className="space-y-2 rounded-md border bg-muted/20 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Step {index + 1}
                        </span>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          min={0}
                          step={0.5}
                          disabled={!canEdit}
                          value={step.delay_hours}
                          onChange={(e) =>
                            patchStep(cadence.id, index, { delay_hours: e.target.value })
                          }
                        />
                        <span className="text-xs text-muted-foreground">hours after enroll</span>
                        <Select
                          value={step.channel}
                          onValueChange={(v) => {
                            if (
                              v === 'wa_template' ||
                              v === 'call_task' ||
                              v === 'voice_note_task'
                            ) {
                              patchStep(cadence.id, index, { channel: v });
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-44" disabled={!canEdit}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="wa_template">WhatsApp template</SelectItem>
                            <SelectItem value="call_task">Call task</SelectItem>
                            <SelectItem value="voice_note_task">Voice note task</SelectItem>
                          </SelectContent>
                        </Select>
                        {canEdit && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-auto"
                            onClick={() =>
                              setDrafts((prev) => ({
                                ...prev,
                                [cadence.id]: (prev[cadence.id] ?? []).filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                      {step.channel === 'wa_template' ? (
                        <Select
                          value={step.template_name || '__none__'}
                          onValueChange={(v) => {
                            if (v == null) return
                            patchStep(cadence.id, index, {
                              template_name: v === '__none__' ? '' : v,
                            })
                          }}
                        >
                          <SelectTrigger className="w-full" disabled={!canEdit}>
                            <SelectValue placeholder="Approved template" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select template…</SelectItem>
                            {templates.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs">Call script (English)</Label>
                            <Textarea
                              className="mt-1 min-h-16"
                              disabled={!canEdit}
                              value={step.script_en}
                              onChange={(e) =>
                                patchStep(cadence.id, index, { script_en: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Call script (Hindi)</Label>
                            <Textarea
                              className="mt-1 min-h-16"
                              disabled={!canEdit}
                              value={step.script_hi}
                              onChange={(e) =>
                                patchStep(cadence.id, index, { script_hi: e.target.value })
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canEdit && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDrafts((prev) => ({
                          ...prev,
                          [cadence.id]: [
                            ...(prev[cadence.id] ?? []),
                            {
                              delay_hours: '24',
                              channel: 'call_task',
                              template_name: '',
                              script_en: '',
                              script_hi: '',
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="size-3.5" />
                      <span className="ml-1.5">Add step</span>
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingId === cadence.id}
                      onClick={() => void save(cadence)}
                    >
                      {savingId === cadence.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      <span className={savingId === cadence.id ? 'ml-1.5' : ''}>
                        Save cadence
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
