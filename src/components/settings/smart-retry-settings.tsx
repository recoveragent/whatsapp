'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type Setting = {
  whatsapp_config_id: string;
  enabled: boolean;
  template_id: string | null;
  company_name: string;
};
type Data = {
  configs: { id: string; reference_name: string; phone_number_id: string }[];
  settings: Setting[];
  templates: {
    id: string;
    whatsapp_config_id: string;
    name: string;
    language: string;
    category: string;
  }[];
  recoveries: {
    id: string;
    recipient: string;
    status: string;
    error_message: string | null;
    created_at: string;
    expires_at: string;
  }[];
};

export function SmartRetrySettings() {
  const { canEditSettings } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function load() {
    try {
      const response = await fetch('/api/whatsapp/smart-retry', {
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'Failed to load Smart Retry');
      setData(result);
      setSettings(
        result.configs.map(
          (config: { id: string }) =>
            result.settings.find(
              (s: Setting) => s.whatsapp_config_id === config.id
            ) ?? {
              whatsapp_config_id: config.id,
              enabled: false,
              template_id: null,
              company_name: '',
            }
        )
      );
      setError('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load Smart Retry'
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function change(id: string, patch: Partial<Setting>) {
    setSettings((current) =>
      current.map((s) => (s.whatsapp_config_id === id ? { ...s, ...patch } : s))
    );
  }
  async function save(setting: Setting) {
    setBusy(setting.whatsapp_config_id);
    try {
      const response = await fetch('/api/whatsapp/smart-retry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setting),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? 'Unable to save Smart Retry');
      toast.success('Smart Retry settings saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to save Smart Retry'
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Smart Retry · 131049</CardTitle>
        <CardDescription>
          Recover failed marketing templates from broadcasts, flows, and inbox
          messages when a customer taps Receive message.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-muted-foreground text-sm">
          Only error 131049 triggers a prompt. Maximum one prompt per recipient
          per WhatsApp number every 24 hours; acceptance expires after 48 hours.
          Each message can be resent once.
        </p>
        <p className="text-muted-foreground text-sm">
          Select a correctly classified, approved template with one quick-reply
          button. Suggested text: “A message from {'{{1}}'} is waiting to be
          delivered. Tap below to receive it.” {'{{1}}'} is your company name.
          Meta determines its category; recovery of marketing content does not
          automatically qualify as Utility. Delivery is not guaranteed.
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {!data && !error && <p className="text-sm">Loading…</p>}
        {data?.configs.length === 0 && (
          <p className="text-sm">Connect a WhatsApp number first.</p>
        )}
        {data?.configs.map((config) => {
          const setting = settings.find(
            (s) => s.whatsapp_config_id === config.id
          )!;
          const options = data.templates.filter(
            (t) => t.whatsapp_config_id === config.id
          );
          return (
            <div key={config.id} className="space-y-3 rounded-md border p-4">
              <p className="font-medium">
                {config.reference_name || config.phone_number_id}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={setting.enabled}
                  disabled={!canEditSettings || busy !== null}
                  onChange={(event) =>
                    change(config.id, { enabled: event.target.checked })
                  }
                />{' '}
                Enable Smart Retry
              </label>
              <label className="block space-y-1 text-sm">
                <span>Company name</span>
                <Input
                  value={setting.company_name}
                  maxLength={100}
                  disabled={!canEditSettings || busy !== null}
                  onChange={(event) =>
                    change(config.id, { company_name: event.target.value })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Re-engagement template</span>
                <select
                  className="bg-background h-9 w-full rounded-md border px-3"
                  value={setting.template_id ?? ''}
                  disabled={!canEditSettings || busy !== null}
                  onChange={(event) =>
                    change(config.id, {
                      template_id: event.target.value || null,
                    })
                  }
                >
                  <option value="">Select an approved template</option>
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.language} · {t.category}
                    </option>
                  ))}
                </select>
              </label>
              {options.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Create and sync a template with exactly one quick-reply
                  button, no media header, and at most the company-name
                  variable.
                </p>
              )}
              {canEditSettings && (
                <Button
                  disabled={
                    busy !== null ||
                    !setting.company_name.trim() ||
                    (setting.enabled && !setting.template_id)
                  }
                  onClick={() => void save(setting)}
                >
                  {busy === config.id ? 'Saving…' : 'Save Smart Retry'}
                </Button>
              )}
            </div>
          );
        })}
        {data && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-medium">Recent recovery attempts</p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void load()}
              >
                Refresh
              </Button>
            </div>
            {data.recoveries.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No recovery attempts yet.
              </p>
            )}
            {data.recoveries.map((row) => (
              <div key={row.id} className="border-t py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span>{row.recipient}</span>
                  <span>
                    {['tracking', 'awaiting_acceptance'].includes(row.status) &&
                    Date.parse(row.expires_at) <= Date.now()
                      ? 'expired'
                      : row.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {new Date(row.created_at).toLocaleString()}
                  {row.error_message ? ` · ${row.error_message}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
