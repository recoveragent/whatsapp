'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { InboxMagicMessageSettings } from '@/types';
import type { MagicMessageSettingsResponse } from '@/lib/inbox/magic-message-settings';

export function InboxMagicMessageSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [templateName, setTemplateName] = useState('magic_message');
  const [templateLanguage, setTemplateLanguage] = useState('en_US');
  const [templateReady, setTemplateReady] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [initial, setInitial] = useState<InboxMagicMessageSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/inbox/magic-message-settings', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to load');
        const data = (await res.json()) as MagicMessageSettingsResponse;
        if (cancelled) return;
        setEnabled(data.enabled);
        setTemplateName(data.template_name);
        setTemplateLanguage(data.template_language);
        setTemplateReady(data.template_ready);
        setTemplateStatus(data.template_status);
        setInitial(data);
      } catch {
        if (!cancelled) toast.error('Failed to load Magic Message settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty =
    initial != null &&
    (enabled !== initial.enabled ||
      templateName.trim() !== initial.template_name ||
      templateLanguage.trim() !== initial.template_language);

  async function handleSave() {
    if (!dirty || !canEditSettings) return;
    if (!templateName.trim() || !templateLanguage.trim()) {
      toast.error('Template name and language are required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/inbox/magic-message-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          template_name: templateName.trim(),
          template_language: templateLanguage.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Save failed');
      }
      const data = (await res.json()) as MagicMessageSettingsResponse;
      setInitial(data);
      setEnabled(data.enabled);
      setTemplateName(data.template_name);
      setTemplateLanguage(data.template_language);
      setTemplateReady(data.template_ready);
      setTemplateStatus(data.template_status);
      toast.success('Magic Message settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Sparkles className="size-4 text-primary" />
            Magic Message
          </CardTitle>
          <CardDescription>
            When the 24-hour WhatsApp window closes, agents can still type
            free-form replies. Your text is rendered as an image and delivered
            through an approved Utility template with an image header.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading || profileLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Enabled</p>
                  <p className="text-xs text-muted-foreground">
                    Allow Magic Message sends from the inbox when the session is
                    expired.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!canEditSettings}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="size-4 accent-primary"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="magic-template-name">Template name</Label>
                  <Input
                    id="magic-template-name"
                    value={templateName}
                    disabled={!canEditSettings}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="magic-template-language">Language</Label>
                  <Input
                    id="magic-template-language"
                    value={templateLanguage}
                    disabled={!canEditSettings}
                    onChange={(e) => setTemplateLanguage(e.target.value)}
                  />
                </div>
              </div>

              <div
                className={
                  templateReady
                    ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400'
                    : 'rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400'
                }
              >
                {templateReady
                  ? 'Utility image-header template is approved and ready.'
                  : `Template not ready${templateStatus ? ` (${templateStatus})` : ''}. Push the magic_message preset from Admin → Templates, add a sample header image, and wait for Meta approval.`}
              </div>

              {canEditSettings && (
                <Button onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save Magic Message settings'
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
