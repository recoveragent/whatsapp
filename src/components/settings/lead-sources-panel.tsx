'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  parseSheetGid,
  parseSpreadsheetId,
} from '@/lib/google-sheets/parse-sheet-url';
import type { Cadence, LeadLanguage, LeadSource } from '@/lib/leads/types';
import { useCan } from '@/hooks/use-can';

interface PreviewResponse {
  title?: string;
  tabs?: Array<{ title: string; sheetId?: number }>;
  headers?: string[];
  sheetName?: string;
  suggested_phone_column?: string;
  error?: string;
}

interface SourceForm {
  name: string;
  cadence_id: string;
  spreadsheet_url: string;
  sheet_name: string;
  phone_column: string;
  name_column: string;
  email_column: string;
  language_column: string;
  default_language: LeadLanguage;
  sync_existing: boolean;
}

const emptyForm = (): SourceForm => ({
  name: '',
  cadence_id: '',
  spreadsheet_url: '',
  sheet_name: '',
  phone_column: 'phone',
  name_column: 'name',
  email_column: 'email',
  language_column: '',
  default_language: 'en',
  sync_existing: false,
});

export function LeadSourcesPanel({ googleConnected }: { googleConnected: boolean }) {
  const canEdit = useCan('edit-settings');
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [cadences, setCadences] = useState<Cadence[]>([]);
  const [form, setForm] = useState<SourceForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [srcRes, cadRes] = await Promise.all([
        fetch('/api/leads/sources', { cache: 'no-store' }),
        fetch('/api/leads/cadences', { cache: 'no-store' }),
      ]);
      const srcJson = (await srcRes.json()) as { sources?: LeadSource[]; error?: string };
      const cadJson = (await cadRes.json()) as { cadences?: Cadence[]; error?: string };
      if (!srcRes.ok) throw new Error(srcJson.error ?? 'Failed to load sources');
      if (!cadRes.ok) throw new Error(cadJson.error ?? 'Failed to load cadences');
      setSources(srcJson.sources ?? []);
      const list = cadJson.cadences ?? [];
      setCadences(list);
      setForm((prev) => {
        if (prev.cadence_id) return prev;
        const def = list.find((c) => c.kind === 'new_lead') ?? list[0];
        return def ? { ...prev, cadence_id: def.id } : prev;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load lead sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadPreview(sheetName?: string) {
    const url = form.spreadsheet_url.trim();
    const id = parseSpreadsheetId(url);
    if (!id) {
      toast.error('Paste a valid Google Sheet URL');
      return;
    }
    setPreviewing(true);
    try {
      const requestedTab = (sheetName ?? form.sheet_name).trim() || undefined;
      const preview = async (tab?: string) => {
        const res = await fetch('/api/google-sheets/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheet_url: url,
            sheet_name: tab,
          }),
        });
        const data = (await res.json()) as PreviewResponse;
        if (!res.ok) throw new Error(data.error ?? 'Could not load spreadsheet');
        return data;
      };

      let data = await preview(requestedTab);
      const tabInfos = data.tabs ?? [];
      const nextTabs = tabInfos.map((t) => t.title).filter(Boolean);
      const gid = parseSheetGid(url);
      const gidTab =
        gid != null
          ? tabInfos.find((t) => t.sheetId === gid)?.title
          : undefined;
      const nextSheet =
        requestedTab && nextTabs.includes(requestedTab)
          ? requestedTab
          : gidTab || data.sheetName || nextTabs[0] || '';

      if (nextSheet && nextSheet !== data.sheetName) {
        data = await preview(nextSheet);
      }

      setTabs(nextTabs.length > 0 ? nextTabs : data.tabs?.map((t) => t.title).filter(Boolean) ?? []);
      setHeaders(data.headers ?? []);
      const phoneGuess =
        data.suggested_phone_column &&
        (data.headers ?? []).includes(data.suggested_phone_column)
          ? data.suggested_phone_column
          : undefined;
      setForm((prev) => ({
        ...prev,
        sheet_name: nextSheet || prev.sheet_name,
        name: prev.name || data.title || prev.name,
        phone_column: phoneGuess || prev.phone_column,
      }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  }

  async function addSource() {
    if (!canEdit) return;
    if (!form.sheet_name.trim()) {
      toast.error('Click Load, then pick a sheet tab');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/leads/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not save source');
      toast.success('Campaign sheet added');
      setForm((prev) => ({ ...emptyForm(), cadence_id: prev.cadence_id }));
      setTabs([]);
      setHeaders([]);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function removeSource(id: string) {
    if (!canEdit) return;
    try {
      const res = await fetch(`/api/leads/sources/${id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not delete');
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const columns = headers.length > 0 ? headers : ['phone', 'name', 'email'];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-cabinet text-base font-semibold">Campaign sheets</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Each Meta Instant Form spreadsheet is a campaign. New rows enroll in
          that campaign&apos;s cadence (WhatsApp templates + call tasks).
        </p>
      </div>

      {!googleConnected && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Connect Google above before adding sheets.
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading sources…
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{source.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {source.sheet_name}
                  {source.cadence
                    ? ` · ${source.cadence.name}`
                    : ' · no cadence'}
                  {source.sync_existing ? ' · importing existing rows' : ''}
                  {source.active ? '' : ' · paused'}
                </p>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => void removeSource(source.id)}
                  aria-label="Remove campaign sheet"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          {sources.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No campaign sheets yet. Add each Instant Form dump below.
            </p>
          )}
        </div>
      )}

      {canEdit && googleConnected && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Add a campaign sheet
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Campaign name</Label>
              <Input
                className="mt-1 bg-background"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="April Hindi ads"
              />
            </div>
            <div>
              <Label className="text-xs">Cadence</Label>
              <Select
                value={form.cadence_id || undefined}
                onValueChange={(v) => {
                  if (v) setForm((p) => ({ ...p, cadence_id: v }));
                }}
              >
                <SelectTrigger className="mt-1 w-full bg-background">
                  <SelectValue placeholder="Pick a cadence" />
                </SelectTrigger>
                <SelectContent>
                  {cadences.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.kind === 'reactivation' ? ' (old leads)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Google Sheet URL</Label>
            <div className="mt-1 flex gap-2">
              <Input
                className="bg-background"
                value={form.spreadsheet_url}
                onChange={(e) =>
                  setForm((p) => ({ ...p, spreadsheet_url: e.target.value }))
                }
                placeholder="https://docs.google.com/spreadsheets/d/…"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={previewing}
                onClick={() => void loadPreview()}
              >
                {previewing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                <span className="ml-1.5">Load</span>
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-xs">Sheet tab</Label>
            <Select
              value={form.sheet_name || undefined}
              onValueChange={(v) => {
                if (!v) return;
                setForm((p) => ({ ...p, sheet_name: v }));
                void loadPreview(v);
              }}
            >
              <SelectTrigger className="mt-1 w-full bg-background">
                <SelectValue
                  placeholder={
                    tabs.length === 0
                      ? 'Click Load to list tabs'
                      : 'Select tab'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(tabs.length > 0
                  ? tabs
                  : form.sheet_name
                    ? [form.sheet_name]
                    : []
                ).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tabs.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Paste the spreadsheet URL and click Load — every tab in the
                file will show up here.
              </p>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ColumnField
              label="Phone"
              value={form.phone_column}
              options={columns}
              onChange={(v) => setForm((p) => ({ ...p, phone_column: v }))}
            />
            <ColumnField
              label="Name"
              value={form.name_column}
              options={columns}
              onChange={(v) => setForm((p) => ({ ...p, name_column: v }))}
            />
            <ColumnField
              label="Email"
              value={form.email_column}
              options={['', ...columns]}
              onChange={(v) => setForm((p) => ({ ...p, email_column: v }))}
            />
            <ColumnField
              label="Language"
              value={form.language_column}
              options={['', ...columns]}
              onChange={(v) => setForm((p) => ({ ...p, language_column: v }))}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Default language</Label>
              <Select
                value={form.default_language}
                onValueChange={(v) => {
                  if (v === 'hi' || v === 'en') {
                    setForm((p) => ({ ...p, default_language: v }));
                  }
                }}
              >
                <SelectTrigger className="h-8 w-28 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="hi">Hindi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.sync_existing}
                onCheckedChange={(v) =>
                  setForm((p) => ({ ...p, sync_existing: v === true }))
                }
              />
              Import existing rows (old leads → use Reactivation cadence)
            </label>
          </div>
          <Button type="button" disabled={saving} onClick={() => void addSource()}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            <span className="ml-1.5">Add campaign</span>
          </Button>
        </div>
      )}
    </div>
  );
}

function ColumnField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const opts = [...new Set(options.filter((o) => o != null))];
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select
        value={value || '__none__'}
        onValueChange={(v) => {
          if (v == null) return
          onChange(v === '__none__' ? '' : v)
        }}
      >
        <SelectTrigger className="mt-1 w-full bg-background">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o || '__none__'} value={o || '__none__'}>
              {o || '—'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
