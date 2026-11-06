'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

interface WidgetForm {
  enabled: boolean;
  domains: string;
  title: string;
  greeting: string;
  accent_color: string;
  whatsapp_number: string;
  daily_reply_limit: number;
}

interface WidgetSettings {
  public_key: string;
  enabled: boolean;
  allowed_domains: string[];
  title: string;
  greeting: string;
  accent_color: string;
  whatsapp_number: string | null;
  daily_reply_limit: number;
  replies_used_today: number;
}

const DEFAULT_FORM: WidgetForm = {
  enabled: false,
  domains: '',
  title: 'Chat with us',
  greeting: 'Hi! How can we help you today?',
  accent_color: '#128C7E',
  whatsapp_number: '',
  daily_reply_limit: 500,
};

function toForm(settings: WidgetSettings): WidgetForm {
  return {
    enabled: settings.enabled,
    domains: settings.allowed_domains.join('\n'),
    title: settings.title,
    greeting: settings.greeting,
    accent_color: settings.accent_color,
    whatsapp_number: settings.whatsapp_number ?? '',
    daily_reply_limit: settings.daily_reply_limit,
  };
}

export function WebsiteWidgetSettings() {
  const { canEditSettings } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<WidgetSettings | null>(null);
  const [form, setForm] = useState<WidgetForm>(DEFAULT_FORM);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/website-widget', { cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? 'Failed to load settings');
        if (cancelled) return;
        if (payload.settings) {
          setSaved(payload.settings);
          setForm(toForm(payload.settings));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : 'Failed to load settings'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof WidgetForm>(key: K, value: WidgetForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/website-widget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.enabled,
          allowed_domains: form.domains
            .split(/[\s,]+/)
            .map((domain) => domain.trim())
            .filter(Boolean),
          title: form.title,
          greeting: form.greeting,
          accent_color: form.accent_color,
          whatsapp_number: form.whatsapp_number,
          daily_reply_limit: form.daily_reply_limit,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Failed to save settings');
      setSaved(payload.settings);
      setForm(toForm(payload.settings));
      toast.success('Widget settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const snippet = saved
    ? `<script src="${window.location.origin}/widget.js" data-key="${saved.public_key}" async></script>`
    : '';

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the code and copy it manually.');
    }
  };

  const disabled = !canEditSettings || saving;

  return (
    <div className="space-y-4">
      <SettingsPanelHead
        title="Website widget"
        description="Add your trained AI agent to your website as a chat bubble."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading...
        </div>
      ) : loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settings</CardTitle>
              <CardDescription>
                Visitors chat anonymously, so the agent answers from your
                knowledge base and catalog but can&apos;t see orders. Chats
                aren&apos;t saved to the inbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
                <div className="space-y-1">
                  <Label htmlFor="widget-enabled">Show the widget</Label>
                  <p className="text-xs text-muted-foreground">
                    Turning this off hides it from your website straight away.
                  </p>
                </div>
                <Switch
                  id="widget-enabled"
                  checked={form.enabled}
                  disabled={disabled}
                  onCheckedChange={(checked) => update('enabled', checked)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-domains">Website domains</Label>
                <Textarea
                  id="widget-domains"
                  rows={3}
                  value={form.domains}
                  disabled={disabled}
                  placeholder={'yourstore.com\nyourstore.myshopify.com'}
                  onChange={(event) => update('domains', event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  One per line. The widget only appears on these sites, and
                  subdomains need their own line.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="widget-title">Title</Label>
                  <Input
                    id="widget-title"
                    maxLength={60}
                    value={form.title}
                    disabled={disabled}
                    onChange={(event) => update('title', event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="widget-color">Colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Pick a colour"
                      value={form.accent_color}
                      disabled={disabled}
                      onChange={(event) =>
                        update('accent_color', event.target.value)
                      }
                      className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1 disabled:cursor-default"
                    />
                    <Input
                      id="widget-color"
                      maxLength={7}
                      value={form.accent_color}
                      disabled={disabled}
                      onChange={(event) =>
                        update('accent_color', event.target.value)
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-greeting">Greeting</Label>
                <Textarea
                  id="widget-greeting"
                  rows={2}
                  maxLength={300}
                  value={form.greeting}
                  disabled={disabled}
                  onChange={(event) => update('greeting', event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="widget-whatsapp">WhatsApp number</Label>
                  <Input
                    id="widget-whatsapp"
                    inputMode="tel"
                    placeholder="919876543210"
                    value={form.whatsapp_number}
                    disabled={disabled}
                    onChange={(event) =>
                      update('whatsapp_number', event.target.value)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    With country code. Visitors who need your team continue
                    here. Without a number, they&apos;re told to contact the
                    store.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="widget-limit">Daily reply limit</Label>
                  <Input
                    id="widget-limit"
                    type="number"
                    min={1}
                    max={100000}
                    value={form.daily_reply_limit}
                    disabled={disabled}
                    onChange={(event) =>
                      update(
                        'daily_reply_limit',
                        Number.parseInt(event.target.value, 10) || 0
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Caps what the widget can spend on your AI key.
                    {saved
                      ? ` ${saved.replies_used_today} used today.`
                      : ''}
                  </p>
                </div>
              </div>

              {canEditSettings ? (
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save'}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ask an admin to change these settings.
                </p>
              )}
            </CardContent>
          </Card>

          {saved && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Install on your website</CardTitle>
                <CardDescription>
                  In Shopify, go to Online Store → Themes → ⋯ → Edit code, open{' '}
                  <code>layout/theme.liquid</code>, and paste this just before{' '}
                  <code>{'</body>'}</code>. On other sites, add it to the
                  footer of every page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs">
                  <code>{snippet}</code>
                </pre>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copySnippet()}
                >
                  {copied ? (
                    <Check className="mr-1.5 size-4" />
                  ) : (
                    <Copy className="mr-1.5 size-4" />
                  )}
                  {copied ? 'Copied' : 'Copy code'}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
