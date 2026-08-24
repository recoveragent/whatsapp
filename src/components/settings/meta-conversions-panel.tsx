'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/hooks/use-can';
import { SettingsPanelHead } from './settings-panel-head';

interface ConversionsPayload {
  configured?: boolean;
  enabled?: boolean;
  dataset_id?: string | null;
  crm_dataset_id?: string | null;
  test_event_code?: string | null;
  send_on_replied?: boolean;
  send_on_qualified?: boolean;
  send_on_not_interested?: boolean;
  send_on_wrong_number?: boolean;
  send_on_instant_form_lead?: boolean;
  whatsapp_connected?: boolean;
  waba_id?: string | null;
  stats?: { sent: number; skipped: number };
  error?: string;
}

export function MetaConversionsPanel() {
  const canEdit = useCan('edit-settings');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ConversionsPayload | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [crmDatasetId, setCrmDatasetId] = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  const [sendOnReplied, setSendOnReplied] = useState(true);
  const [sendOnQualified, setSendOnQualified] = useState(true);
  const [sendOnNotInterested, setSendOnNotInterested] = useState(true);
  const [sendOnWrongNumber, setSendOnWrongNumber] = useState(true);
  const [sendOnInstantFormLead, setSendOnInstantFormLead] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/meta/conversions', { cache: 'no-store' });
      const payload = (await res.json()) as ConversionsPayload;
      if (!res.ok) throw new Error(payload.error ?? 'Failed to load settings');
      setData(payload);
      setEnabled(payload.enabled ?? false);
      setCrmDatasetId(payload.crm_dataset_id ?? '');
      setTestEventCode(payload.test_event_code ?? '');
      setSendOnReplied(payload.send_on_replied ?? true);
      setSendOnQualified(payload.send_on_qualified ?? true);
      setSendOnNotInterested(payload.send_on_not_interested ?? true);
      setSendOnWrongNumber(payload.send_on_wrong_number ?? true);
      setSendOnInstantFormLead(payload.send_on_instant_form_lead ?? true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load Meta CAPI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/meta/conversions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          crm_dataset_id: crmDatasetId.trim() || null,
          test_event_code: testEventCode.trim() || null,
          send_on_replied: sendOnReplied,
          send_on_qualified: sendOnQualified,
          send_on_not_interested: sendOnNotInterested,
          send_on_wrong_number: sendOnWrongNumber,
          send_on_instant_form_lead: sendOnInstantFormLead,
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'Save failed');
      toast.success('Meta conversions settings saved');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const refreshDataset = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/meta/conversions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_dataset: true }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'Refresh failed');
      toast.success('WhatsApp dataset ID refreshed from Meta');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Meta conversions…
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <SettingsPanelHead
          title="Meta Conversions API"
          description="Send lead quality back to Meta for CTWA ads and Instant Form leads. CTWA uses your WhatsApp dataset; Instant Forms use a separate CRM dataset."
        />
      </CardHeader>
      <CardContent className="space-y-6">
        {!data?.whatsapp_connected && (
          <Alert variant="destructive">
            <AlertTitle>WhatsApp not connected</AlertTitle>
            <AlertDescription>
              Connect WhatsApp first — CAPI reuses your access token for both messaging and CRM
              events.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div>
            <p className="font-medium">Enable lead quality feedback</p>
            <p className="text-sm text-muted-foreground">
              Sends conversion events when leads move through your cadence pipeline.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="meta-dataset-id">WhatsApp dataset (CTWA)</Label>
            <div className="flex gap-2">
              <Input
                id="meta-dataset-id"
                readOnly
                value={data?.dataset_id ?? 'Not set — refresh from Meta'}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void refreshDataset()}
                disabled={!canEdit || refreshing || !data?.whatsapp_connected}
                title="Fetch WhatsApp dataset from Meta"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
            {data?.waba_id && (
              <p className="text-xs text-muted-foreground">WABA: {data.waba_id}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="meta-crm-dataset-id">CRM dataset (Instant Forms)</Label>
            <Input
              id="meta-crm-dataset-id"
              placeholder="Paste Meta CRM pixel / dataset ID"
              value={crmDatasetId}
              onChange={(e) => setCrmDatasetId(e.target.value)}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">
              From Events Manager → your CRM dataset for Conversion Leads optimization.
            </p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="meta-test-code">Test event code (optional)</Label>
            <Input
              id="meta-test-code"
              placeholder="TEST12345"
              value={testEventCode}
              onChange={(e) => setTestEventCode(e.target.value)}
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Positive signals</p>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-instant-form" className="font-normal">
              New Instant Form row enrolled → New Lead (CRM)
            </Label>
            <Switch
              id="send-instant-form"
              checked={sendOnInstantFormLead}
              onCheckedChange={setSendOnInstantFormLead}
              disabled={!canEdit}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-replied" className="font-normal">
              Customer replied → Contacted / LeadSubmitted
            </Label>
            <Switch
              id="send-replied"
              checked={sendOnReplied}
              onCheckedChange={setSendOnReplied}
              disabled={!canEdit}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-qualified" className="font-normal">
              Meeting booked → Qualified / QualifiedLead
            </Label>
            <Switch
              id="send-qualified"
              checked={sendOnQualified}
              onCheckedChange={setSendOnQualified}
              disabled={!canEdit}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">Negative signals</p>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-not-interested" className="font-normal">
              Not interested → Not Interested
            </Label>
            <Switch
              id="send-not-interested"
              checked={sendOnNotInterested}
              onCheckedChange={setSendOnNotInterested}
              disabled={!canEdit}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="send-wrong-number" className="font-normal">
              Wrong number → Wrong Number
            </Label>
            <Switch
              id="send-wrong-number"
              checked={sendOnWrongNumber}
              onCheckedChange={setSendOnWrongNumber}
              disabled={!canEdit}
            />
          </div>
        </div>

        {data?.stats && (data.stats.sent > 0 || data.stats.skipped > 0) && (
          <p className="text-sm text-muted-foreground">
            Sent {data.stats.sent} event{data.stats.sent === 1 ? '' : 's'}
            {data.stats.skipped > 0 ? ` · ${data.stats.skipped} skipped` : ''}
          </p>
        )}

        <Alert>
          <AlertTitle>Two attribution paths</AlertTitle>
          <AlertDescription>
            CTWA leads need <code className="text-xs">ctwa_clid</code> on the contact (from the
            WhatsApp webhook). Instant Form leads need Meta fields from your Google Sheet (
            <code className="text-xs">id</code>, <code className="text-xs">ad_id</code>, etc.) plus
            a CRM dataset ID above.
          </AlertDescription>
        </Alert>

        {canEdit && (
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save settings'
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
