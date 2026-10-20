'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BuilderNode } from '../shared';
import { TextRow } from './fields';

interface MetaFlow {
  id: string;
  name: string;
  status: string;
}

interface FlowDetails {
  entry_screen: string | null;
  screen_ids: string[];
  fields: Array<{ key: string; label?: string }>;
  flow: MetaFlow;
}

export interface SendFlowCfg {
  body_text?: string;
  header_text?: string;
  footer_text?: string;
  flow_id?: string;
  flow_name?: string;
  flow_cta?: string;
  flow_screen?: string;
  flow_mode?: 'published' | 'draft';
  flow_data?: Record<string, string>;
  flow_fields?: Array<{ key: string; label?: string }>;
  var_key?: string;
  next_node_key?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function SendFlowFields({
  cfg,
  onUpdateConfig,
}: {
  cfg: SendFlowCfg;
  allNodes: BuilderNode[];
  currentKey: string;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const [flows, setFlows] = useState<MetaFlow[] | null>(null);
  const [listError, setListError] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [screens, setScreens] = useState<string[]>([]);
  const [manualId, setManualId] = useState(false);

  const loadFlows = useCallback(async () => {
    setLoadingList(true);
    setListError('');
    try {
      const { flows } = await getJson<{ flows: MetaFlow[] }>('/api/whatsapp/flows');
      setFlows(flows);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  const loadDetails = useCallback(
    async (flowId: string) => {
      setLoadingDetails(true);
      try {
        const d = await getJson<FlowDetails>(`/api/whatsapp/flows/${encodeURIComponent(flowId)}`);
        setScreens(d.screen_ids);
        onUpdateConfig({
          flow_id: flowId,
          flow_name: d.flow.name,
          flow_screen: d.entry_screen ?? '',
          flow_fields: d.fields,
          flow_mode: d.flow.status === 'DRAFT' ? 'draft' : 'published',
        });
        if (d.flow.status !== 'PUBLISHED' && d.flow.status !== 'DRAFT') {
          toast.warning(`This form is ${d.flow.status} in Meta — customers may not be able to open it.`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not read the form from Meta');
      } finally {
        setLoadingDetails(false);
      }
    },
    [onUpdateConfig],
  );

  const flowId = cfg.flow_id ?? '';
  const varKey = cfg.var_key || 'form';
  const fields = cfg.flow_fields ?? [];
  const flowData = Object.entries(cfg.flow_data ?? {});
  const knownFlow = flows?.some((f) => f.id === flowId);
  const setFlowData = (entries: Array<[string, string]>) =>
    onUpdateConfig({ flow_data: Object.fromEntries(entries) });

  return (
    <>
      <p className="text-muted-foreground text-[11px]">
        Sends a button that opens a WhatsApp Form. Build the form&apos;s
        questions (text boxes, radio buttons, checkboxes, dropdowns, dates)
        in{' '}
        <a href="/flows/forms" target="_blank" rel="noreferrer" className="text-primary underline">
          WhatsApp forms
        </a>
        , publish it, then pick it here. Answers are saved under{' '}
        <code className="bg-muted rounded px-1">{`{{vars.${varKey}.<field>}}`}</code>{' '}
        before the flow moves on.
      </p>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-muted-foreground block text-xs">WhatsApp form</label>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => setManualId((v) => !v)}
            >
              {manualId ? 'Pick from list' : 'Enter ID'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => void loadFlows()}
              disabled={loadingList}
              aria-label="Refresh forms"
            >
              <RefreshCw className={loadingList ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            </Button>
          </div>
        </div>
        {manualId ? (
          <div className="flex gap-2">
            <Input
              value={flowId}
              onChange={(e) => onUpdateConfig({ flow_id: e.target.value.trim() })}
              placeholder="Meta Flow ID"
              className="bg-muted font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!flowId || loadingDetails}
              onClick={() => void loadDetails(flowId)}
            >
              Load
            </Button>
          </div>
        ) : (
          <Select
            value={flowId || undefined}
            onValueChange={(id) => { if (id) void loadDetails(id); }}
            disabled={loadingList || loadingDetails}
          >
            <SelectTrigger className="bg-muted w-full text-xs">
              <SelectValue placeholder={loadingList ? 'Loading forms…' : 'Choose a form'}>
                {flowId ? flows?.find((f) => f.id === flowId)?.name || cfg.flow_name || flowId : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="min-w-72">
              {flowId && !knownFlow && (
                <SelectItem value={flowId}>{cfg.flow_name || flowId}</SelectItem>
              )}
              {(flows ?? []).map((f) => (
                <SelectItem key={f.id} value={f.id} disabled={f.status === 'DEPRECATED' || f.status === 'BLOCKED'}>
                  {f.name} · {f.status.toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {loadingDetails && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading form from Meta…
          </p>
        )}
        <a
          href="/flows/forms"
          target="_blank"
          rel="noreferrer"
          className="text-primary mt-1 inline-flex items-center gap-1 text-[11px] underline"
        >
          <Plus className="h-3 w-3" /> Create or edit forms
        </a>
        {listError && (
          <p className="text-destructive mt-1 text-[11px]">
            {listError} — you can still enter the Flow ID manually.
          </p>
        )}
        {flows && flows.length === 0 && !listError && (
          <p className="text-muted-foreground mt-1 text-[11px]">
            No forms on your WhatsApp Business account yet. Create one in WhatsApp Manager → Flows.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">First screen</label>
          {screens.length > 0 ? (
            <Select value={cfg.flow_screen || undefined} onValueChange={(v) => { if (v) onUpdateConfig({ flow_screen: v }); }}>
              <SelectTrigger className="bg-muted font-mono text-xs">
                <SelectValue placeholder="Screen" />
              </SelectTrigger>
              <SelectContent>
                {screens.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={cfg.flow_screen ?? ''}
              onChange={(e) => onUpdateConfig({ flow_screen: e.target.value.trim() })}
              placeholder="Filled in when you pick a form"
              className="bg-muted font-mono text-xs"
            />
          )}
        </div>
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">Send as</label>
          <Select
            value={cfg.flow_mode === 'draft' ? 'draft' : 'published'}
            onValueChange={(v) => { if (v) onUpdateConfig({ flow_mode: v }); }}
          >
            <SelectTrigger className="bg-muted text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="published">Published form</SelectItem>
              <SelectItem value="draft">Draft (testing only)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-muted-foreground mb-1 block text-xs">CTA button label</label>
        <Input
          value={cfg.flow_cta ?? 'Open form'}
          onChange={(e) => onUpdateConfig({ flow_cta: e.target.value })}
          placeholder="Open form"
          maxLength={20}
          className="bg-muted text-xs"
        />
      </div>
      <TextRow label="Body text" value={cfg.body_text ?? ''} onChange={(v) => onUpdateConfig({ body_text: v })} rows={2} />
      <TextRow label="Header (optional)" value={cfg.header_text ?? ''} onChange={(v) => onUpdateConfig({ header_text: v })} rows={1} />
      <TextRow label="Footer (optional)" value={cfg.footer_text ?? ''} onChange={(v) => onUpdateConfig({ footer_text: v })} rows={1} />

      <div>
        <label className="text-muted-foreground mb-1 block text-xs">
          Prefill data for the first screen (optional)
        </label>
        <div className="space-y-1">
          {flowData.map(([k, v], i) => (
            <div key={i} className="flex gap-1">
              <Input
                value={k}
                placeholder="key"
                className="bg-muted w-1/3 font-mono text-xs"
                onChange={(e) =>
                  setFlowData(flowData.map((row, j) => (j === i ? [e.target.value.replace(/[^\w-]/g, ''), row[1]] : row)))
                }
              />
              <Input
                value={v}
                placeholder="value or {{vars.name}}"
                className="bg-muted text-xs"
                onChange={(e) => setFlowData(flowData.map((row, j) => (j === i ? [row[0], e.target.value] : row)))}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Remove"
                onClick={() => setFlowData(flowData.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFlowData([...flowData, ['', '']])}
          >
            <Plus className="mr-1 h-3 w-3" /> Add value
          </Button>
        </div>
      </div>

      <div>
        <label className="text-muted-foreground mb-1 block text-xs">Save answers as</label>
        <Input
          value={cfg.var_key ?? ''}
          onChange={(e) => onUpdateConfig({ var_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
          placeholder="e.g. form, lead_details"
          className="bg-muted font-mono text-xs"
        />
      </div>

      {fields.length > 0 ? (
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            Answers available in later steps (click to copy)
          </label>
          <div className="flex flex-wrap gap-1">
            {fields.map((f) => {
              const token = `{{vars.${varKey}.${f.key}}}`;
              return (
                <button
                  key={f.key}
                  type="button"
                  title={token}
                  className="bg-muted hover:bg-muted/70 rounded px-1.5 py-0.5 text-left font-mono text-[10px]"
                  onClick={() => {
                    void navigator.clipboard?.writeText(token);
                    toast.success(`Copied ${token}`);
                  }}
                >
                  {f.label ? `${f.label} · ` : ''}
                  {f.key}
                </button>
              );
            })}
          </div>
        </div>
      ) : flowId ? (
        <p className="text-muted-foreground text-[11px]">
          Pick the form again to see its field keys.
        </p>
      ) : null}

    </>
  );
}
