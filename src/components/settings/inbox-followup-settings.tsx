'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Clock, Inbox, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import type { InboxFollowupSettings } from '@/types';

export function InboxFollowupSettings() {
  const { canEditSettings, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [delayHours, setDelayHours] = useState(4);
  const [messageText, setMessageText] = useState(
    'Hi, We are waiting for your response',
  );
  const [initial, setInitial] = useState<InboxFollowupSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/inbox/followup-settings', {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error('Failed to load');
        const data = (await res.json()) as InboxFollowupSettings;
        if (cancelled) return;
        setDelayHours(data.delay_hours);
        setMessageText(data.message_text);
        setInitial(data);
      } catch {
        if (!cancelled) toast.error('Failed to load inbox follow-up settings');
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
    (delayHours !== initial.delay_hours ||
      messageText.trim() !== initial.message_text);

  async function handleSave() {
    if (!dirty || !canEditSettings) return;
    if (delayHours < 1 || delayHours > 168) {
      toast.error('Delay must be between 1 and 168 hours');
      return;
    }
    if (!messageText.trim()) {
      toast.error('Message cannot be empty');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/inbox/followup-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delay_hours: delayHours,
          message_text: messageText.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Save failed');
      }
      const data = (await res.json()) as InboxFollowupSettings;
      setInitial(data);
      setDelayHours(data.delay_hours);
      setMessageText(data.message_text);
      toast.success('Follow-up settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Inbox"
        description="Configure automated follow-up messages when an agent marks a chat as Followup."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Inbox className="size-4 text-primary" />
            Follow-up message
          </CardTitle>
          <CardDescription>
            After the configured delay, the system sends this message automatically
            to chats in Followup status (within the WhatsApp 24-hour session window).
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
              <div className="space-y-2">
                <Label htmlFor="followup-delay" className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  Send after (hours)
                </Label>
                <Input
                  id="followup-delay"
                  type="number"
                  min={1}
                  max={168}
                  value={delayHours}
                  disabled={!canEditSettings}
                  onChange={(e) => setDelayHours(Number(e.target.value))}
                  className="max-w-[140px]"
                />
                <p className="text-xs text-muted-foreground">
                  Example: 4 hours after marking a chat as Followup.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="followup-message">Message</Label>
                <Textarea
                  id="followup-message"
                  rows={4}
                  value={messageText}
                  disabled={!canEditSettings}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Hi, We are waiting for your response"
                />
              </div>

              {canEditSettings ? (
                <Button onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    'Save changes'
                  )}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Only admins can edit follow-up settings.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
