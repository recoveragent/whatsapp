'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/use-can';

import { SettingsPanelHead } from './settings-panel-head';

interface Source {
  id: string;
  name: string;
  page_id: string;
  form_id: string | null;
  cadence_id: string | null;
  pipeline_id: string;
  stage_id: string;
  default_language: 'en' | 'hi';
  active: boolean;
}

interface Pipeline {
  id: string;
  name: string;
  pipeline_stages: Array<{ id: string; name: string; position: number }>;
}

interface Payload {
  sources: Source[];
  cadences: Array<{ id: string; name: string }>;
  pipelines: Pipeline[];
  callback_url: string;
  verify_token_configured: boolean;
  app_secret_configured: boolean;
  error?: string;
}

interface Draft {
  id: string;
  name: string;
  page_id: string;
  form_id: string;
  access_token: string;
  cadence_id: string;
  pipeline_id: string;
  stage_id: string;
  default_language: 'en' | 'hi';
  active: boolean;
}

const EMPTY: Draft = {
  id: '',
  name: 'Meta Instant Forms',
  page_id: '',
  form_id: '',
  access_token: '',
  cadence_id: '',
  pipeline_id: '',
  stage_id: '',
  default_language: 'en' as const,
  active: true,
};

export function MetaLeadAdsPanel() {
  const canEdit = useCan('edit-settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/meta/leads/source', {
        cache: 'no-store',
      });
      const data = (await response.json()) as Payload;
      if (!response.ok)
        throw new Error(data.error ?? 'Failed to load Meta Lead Ads');
      setPayload(data);
      const source = data.sources[0];
      if (source)
        setDraft({
          ...source,
          form_id: source.form_id ?? '',
          access_token: '',
          cadence_id: source.cadence_id ?? '',
        });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to load Meta Lead Ads'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = useMemo(() => {
    return (
      payload?.pipelines
        .find((item) => item.id === draft.pipeline_id)
        ?.pipeline_stages?.slice()
        .sort((a, b) => a.position - b.position) ?? []
    );
  }, [payload, draft.pipeline_id]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/meta/leads/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Save failed');
      toast.success('Meta Instant Forms connection saved');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    const response = await fetch(
      `/api/meta/leads/source?id=${encodeURIComponent(draft.id)}`,
      { method: 'DELETE' }
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok) return toast.error(data.error ?? 'Delete failed');
    setDraft({ ...EMPTY });
    toast.success('Meta Instant Forms connection removed');
    await load();
  }

  if (loading)
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading Meta Lead Ads…
      </div>
    );

  return (
    <Card>
      <CardHeader>
        <SettingsPanelHead
          title="Meta Instant Forms"
          description="Deliver Meta Lead Ads directly into this CRM, create a New Lead deal, and start a WhatsApp cadence."
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {(!payload?.verify_token_configured ||
          !payload?.app_secret_configured) && (
          <Alert variant="destructive">
            <AlertTitle>Server configuration required</AlertTitle>
            <AlertDescription>
              Add META_LEADS_VERIFY_TOKEN and META_APP_SECRET to the deployment
              environment before Meta verifies this callback.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label>Webhook callback URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={payload?.callback_url ?? ''} />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(payload?.callback_url ?? '');
                toast.success('Callback URL copied');
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Connection name</Label>
            <Input
              value={draft.name}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Facebook Page ID</Label>
            <Input
              value={draft.page_id}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, page_id: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Instant Form ID (optional)</Label>
            <Input
              placeholder="Blank = every form on this Page"
              value={draft.form_id}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, form_id: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Page access token</Label>
            <Input
              type="password"
              placeholder={
                draft.id
                  ? 'Leave blank to keep saved token'
                  : 'Token with leads_retrieval'
              }
              value={draft.access_token}
              disabled={!canEdit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, access_token: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Pipeline</Label>
            <Select
              value={draft.pipeline_id}
              onValueChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  pipeline_id: value ?? '',
                  stage_id: '',
                }))
              }
            >
              <SelectTrigger disabled={!canEdit}>
                <SelectValue placeholder="Select pipeline" />
              </SelectTrigger>
              <SelectContent>
                {payload?.pipelines.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>New Lead stage</Label>
            <Select
              value={draft.stage_id}
              onValueChange={(value) =>
                setDraft((d) => ({ ...d, stage_id: value ?? '' }))
              }
            >
              <SelectTrigger disabled={!canEdit || !draft.pipeline_id}>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>WhatsApp cadence</Label>
            <Select
              value={draft.cadence_id || 'none'}
              onValueChange={(value) =>
                setDraft((d) => ({
                  ...d,
                    cadence_id: value === 'none' || value == null ? '' : value,
                }))
              }
            >
              <SelectTrigger disabled={!canEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Do not auto-enroll</SelectItem>
                {payload?.cadences.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default language</Label>
            <Select
              value={draft.default_language}
              onValueChange={(value) =>
                setDraft((d) => ({
                  ...d,
                  default_language: value as 'en' | 'hi',
                }))
              }
            >
              <SelectTrigger disabled={!canEdit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Active</p>
            <p className="text-muted-foreground text-xs">
              Accept new leads from this Page and form.
            </p>
          </div>
          <Switch
            checked={draft.active}
            disabled={!canEdit}
            onCheckedChange={(active) => setDraft((d) => ({ ...d, active }))}
          />
        </div>
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>After saving</AlertTitle>
          <AlertDescription>
            Subscribe the Meta app’s <code>page</code> webhook to{' '}
            <code>leadgen</code>, use the callback above and your
            META_LEADS_VERIFY_TOKEN, then connect the app to the Facebook Page
            and send a test lead.
          </AlertDescription>
        </Alert>
        {canEdit && (
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {draft.id ? 'Update connection' : 'Save connection'}
            </Button>
            {draft.id && (
              <Button variant="outline" onClick={() => void remove()}>
                <Trash2 className="mr-2 size-4" />
                Remove
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
