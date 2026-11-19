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
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { DEFAULT_PAGE_RULES, type PageRules } from '@/lib/website-widget/page-rules';
import { WidgetPageRules } from './widget-page-rules';

interface WidgetForm {
  enabled: boolean;
  desktop_side_offset: number;
  desktop_bottom_offset: number;
  mobile_side_offset: number;
  mobile_bottom_offset: number;
  desktop_position: 'left' | 'right';
  mobile_position: 'left' | 'right';
  domains: string;
  title: string;
  greeting: string;
  launcher_greeting_enabled: boolean;
  launcher_greeting_text: string;
  launcher_greeting_delay: number;
  launcher_indicator: 'dot' | 'number';
  avatar_url: string;
  show_whatsapp_link: boolean;
  suggested_questions: string[];
  accent_color: string;
  whatsapp_number: string;
  daily_reply_limit: number;
  page_rules: PageRules;
}

interface WidgetSettings {
  public_key: string;
  enabled: boolean;
  desktop_side_offset: number;
  desktop_bottom_offset: number;
  mobile_side_offset: number;
  mobile_bottom_offset: number;
  desktop_position: 'left' | 'right';
  mobile_position: 'left' | 'right';
  allowed_domains: string[];
  title: string;
  greeting: string;
  launcher_greeting_enabled: boolean;
  launcher_greeting_text: string;
  launcher_greeting_delay: number;
  launcher_indicator: 'dot' | 'number';
  avatar_url: string | null;
  show_whatsapp_link: boolean;
  suggested_questions: string[];
  accent_color: string;
  whatsapp_number: string | null;
  daily_reply_limit: number;
  page_rules: PageRules;
  replies_used_today: number;
}

const DEFAULT_FORM: WidgetForm = {
  enabled: false,
  desktop_side_offset: 20,
  desktop_bottom_offset: 20,
  mobile_side_offset: 16,
  mobile_bottom_offset: 16,
  desktop_position: 'right',
  mobile_position: 'right',
  domains: '',
  title: 'Chat with us',
  greeting: 'Hi! How can we help you today?',
  launcher_greeting_enabled: false,
  launcher_greeting_text: 'Hi! How can I help?',
  launcher_greeting_delay: 5,
  launcher_indicator: 'dot',
  avatar_url: '',
  show_whatsapp_link: true,
  suggested_questions: ['Track my order', 'Product information', 'Delivery & shipping'],
  accent_color: '#128C7E',
  whatsapp_number: '',
  daily_reply_limit: 500,
  page_rules: DEFAULT_PAGE_RULES,
};

function toForm(settings: WidgetSettings): WidgetForm {
  return {
    enabled: settings.enabled,
    desktop_side_offset: settings.desktop_side_offset ?? 20,
    desktop_bottom_offset: settings.desktop_bottom_offset ?? 20,
    mobile_side_offset: settings.mobile_side_offset ?? 16,
    mobile_bottom_offset: settings.mobile_bottom_offset ?? 16,
    desktop_position: settings.desktop_position ?? 'right',
    mobile_position: settings.mobile_position ?? 'right',
    domains: settings.allowed_domains.join('\n'),
    title: settings.title,
    greeting: settings.greeting,
    launcher_greeting_enabled: settings.launcher_greeting_enabled ?? false,
    launcher_greeting_text: settings.launcher_greeting_text ?? 'Hi! How can I help?',
    launcher_greeting_delay: settings.launcher_greeting_delay ?? 5,
    launcher_indicator: settings.launcher_indicator ?? 'dot',
    avatar_url: settings.avatar_url ?? '',
    show_whatsapp_link: settings.show_whatsapp_link ?? true,
    suggested_questions: settings.suggested_questions ?? [],
    accent_color: settings.accent_color,
    whatsapp_number: settings.whatsapp_number ?? '',
    daily_reply_limit: settings.daily_reply_limit,
    page_rules: settings.page_rules ?? DEFAULT_PAGE_RULES,
  };
}

export function WebsiteWidgetSettings() {
  const { canEditSettings, isLeadGenBrand } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
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
          desktop_side_offset: form.desktop_side_offset,
          desktop_bottom_offset: form.desktop_bottom_offset,
          mobile_side_offset: form.mobile_side_offset,
          mobile_bottom_offset: form.mobile_bottom_offset,
          desktop_position: form.desktop_position,
          mobile_position: form.mobile_position,
          allowed_domains: form.domains
            .split(/[\s,]+/)
            .map((domain) => domain.trim())
            .filter(Boolean),
          title: form.title,
          greeting: form.greeting,
          launcher_greeting_enabled: form.launcher_greeting_enabled,
          launcher_greeting_text: form.launcher_greeting_text,
          launcher_greeting_delay: form.launcher_greeting_delay,
          launcher_indicator: form.launcher_indicator,
          avatar_url: form.avatar_url,
          show_whatsapp_link: form.show_whatsapp_link,
          suggested_questions: form.suggested_questions.map((question) => question.trim()).filter(Boolean),
          accent_color: form.accent_color,
          whatsapp_number: form.whatsapp_number,
          daily_reply_limit: form.daily_reply_limit,
          page_rules: {
            show: form.page_rules.show,
            include: form.page_rules.include.filter((rule) => rule.value.trim()),
            exclude: form.page_rules.exclude.filter((rule) => rule.value.trim()),
          },
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

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('Choose a JPG, PNG, or WebP image under 5 MB'); return;
    }
    setUploading(true);
    try {
      const result = await uploadAccountMedia('flow-media', file);
      update('avatar_url', result.publicUrl);
      toast.success('Photo uploaded. Save your settings to apply it.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not upload photo'); }
    finally { setUploading(false); }
  };
  const disabled = !canEditSettings || saving || uploading;

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
                {isLeadGenBrand
                  ? 'Visitors chat anonymously. The agent answers from your business knowledge and can offer a demo link included in that knowledge. Website chats can be viewed in the inbox.'
                  : 'Visitors chat anonymously, so the agent answers from your knowledge base and catalog but cannot see orders. Website chats can be viewed in the inbox.'}
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

              <fieldset className="space-y-3 rounded-lg border border-border p-3">
                <legend className="px-1 text-sm font-medium">Chat bubble position</legend>
                <p className="text-xs text-muted-foreground">Choose a bottom corner and its distance from the edges (0-200 px).</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(['desktop', 'mobile'] as const).map((device) => {
                    const field = `${device}_position` as const;
                    return <div key={device} className="space-y-2"><p className="text-sm font-medium capitalize">{device}</p><div className="flex gap-2">
                      {(['left', 'right'] as const).map((position) => <label key={position} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm capitalize ${form[field] === position ? 'border-primary bg-primary/10 text-primary' : 'border-border'} ${disabled ? 'cursor-default opacity-60' : ''}`}><input type="radio" name={field} value={position} checked={form[field] === position} disabled={disabled} onChange={() => update(field, position)} />{position}</label>)}
                    </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(['side', 'bottom'] as const).map((edge) => {
                          const offsetField = `${device}_${edge}_offset` as const;
                          return <div key={edge} className="space-y-1.5">
                            <Label htmlFor={`widget-${offsetField}`}>{edge === 'side' ? 'From side' : 'From bottom'} (px)</Label>
                            <Input id={`widget-${offsetField}`} type="number" min={0} max={200} step={1} value={form[offsetField]} disabled={disabled} onChange={(event) => update(offsetField, event.target.value === '' ? 0 : Number(event.target.value))} />
                          </div>;
                        })}
                      </div>
                    </div>;
                  })}
                </div>
              </fieldset>

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

              <WidgetPageRules
                value={form.page_rules}
                disabled={disabled}
                onChange={(rules) => update('page_rules', rules)}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="widget-title">Assistant name</Label>
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

              <div className="space-y-2">
                <Label htmlFor="widget-avatar">Assistant profile photo</Label>
                <div className="flex items-center gap-3">
                  {form.avatar_url && <img src={form.avatar_url} alt="Assistant profile" className="size-12 rounded-full object-cover" />}
                  <Input id="widget-avatar" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.target.value = ''; }} />
                  {form.avatar_url && <Button type="button" variant="outline" disabled={disabled} onClick={() => update('avatar_url', '')}>Remove</Button>}
                </div>
                <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB. {uploading ? 'Uploading...' : 'Save to apply your photo.'}</p>
              </div>
              <div className="space-y-4 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-4"><div><Label htmlFor="launcher-greeting-enabled">Show launcher greeting</Label><p className="text-xs text-muted-foreground">Show once after the page loads, then hide after 5 seconds.</p></div><Switch id="launcher-greeting-enabled" checked={form.launcher_greeting_enabled} disabled={disabled} onCheckedChange={(checked) => update('launcher_greeting_enabled', checked)} /></div>
                {form.launcher_greeting_enabled && <><div className="space-y-1.5"><Label htmlFor="launcher-greeting-text">Launcher greeting text</Label><Input id="launcher-greeting-text" maxLength={120} value={form.launcher_greeting_text} disabled={disabled} onChange={(event) => update('launcher_greeting_text', event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="launcher-greeting-delay">Show after (seconds)</Label><Input id="launcher-greeting-delay" type="number" min={0} max={300} value={form.launcher_greeting_delay} disabled={disabled} onChange={(event) => update('launcher_greeting_delay', event.target.valueAsNumber)} /></div></>}
                <fieldset className="space-y-2"><legend className="text-sm font-medium">Launcher indicator</legend><div className="flex gap-4">{(['dot', 'number'] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="launcher-indicator" value={value} checked={form.launcher_indicator === value} disabled={disabled} onChange={() => update('launcher_indicator', value)} />{value === 'dot' ? 'Green dot' : 'Number 1'}</label>)}</div></fieldset>
              </div>
              <div className="space-y-2">
                <Label>Suggested questions</Label>
                <p className="text-xs text-muted-foreground">Optional. Add up to 5 conversation starters.</p>
                {form.suggested_questions.map((question, index) => <div className="flex gap-2" key={index}>
                  <Input aria-label={`Suggested question ${index + 1}`} maxLength={100} value={question} disabled={disabled} onChange={(event) => update('suggested_questions', form.suggested_questions.map((item, i) => i === index ? event.target.value : item))} />
                  <Button type="button" variant="outline" disabled={disabled} onClick={() => update('suggested_questions', form.suggested_questions.filter((_, i) => i !== index))}>Remove</Button>
                </div>)}
                <Button type="button" variant="outline" size="sm" disabled={disabled || form.suggested_questions.length >= 5} onClick={() => update('suggested_questions', [...form.suggested_questions, ''])}>Add question</Button>
              </div>
              <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" aria-label="Widget preview">
                <p className="text-sm font-medium">Widget preview</p>
                <div className="flex max-w-sm flex-col items-end gap-2 rounded-xl bg-muted/50 p-4" aria-label="Launcher preview">
                  {form.launcher_greeting_enabled && <div className="flex max-w-full items-center gap-3 rounded-2xl bg-background px-3 py-2 shadow-md">{form.avatar_url ? <img src={form.avatar_url} alt="" className="size-12 shrink-0 rounded-full object-cover" /> : <span className="grid size-12 shrink-0 place-items-center rounded-full bg-muted text-lg">✦</span>}<span className="break-words text-sm">{form.launcher_greeting_text}</span></div>}
                  {(() => { const accent = /^#[0-9a-f]{6}$/i.test(form.accent_color) ? form.accent_color : '#128C7E'; return <div className="relative grid size-[62px] place-items-center rounded-full text-white ring-1 ring-inset ring-white/30" style={{ background: `radial-gradient(120% 120% at 30% 15%, color-mix(in srgb, ${accent} 70%, #fff) 0%, ${accent} 45%, color-mix(in srgb, ${accent} 78%, #000) 100%)`, boxShadow: `0 12px 30px -6px color-mix(in srgb, ${accent} 60%, transparent), 0 4px 12px rgba(15,23,42,.18), inset 0 1px 0 rgba(255,255,255,.35)` }}><svg viewBox="0 0 24 24" aria-hidden="true" className="size-7" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round"><path d="M12 3.75c-4.83 0-8.75 3.36-8.75 7.5 0 2.13 1.04 4.05 2.71 5.42-.2 1.33-.82 2.5-1.71 3.43 1.86.1 3.55-.5 4.86-1.44.92.24 1.89.36 2.89.36 4.83 0 8.75-3.36 8.75-7.5S16.83 3.75 12 3.75z" />{[8, 12, 16].map((cx) => <circle key={cx} cx={cx} cy={11.25} r={1.25} fill="currentColor" stroke="none" />)}</svg>{form.launcher_indicator === 'number' ? <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full border-2 border-white bg-red-500 text-[11px] font-bold text-white">1</span> : <span className="absolute right-0.5 top-0.5 size-4 rounded-full border-2 border-white bg-green-500" />}</div>; })()}
                </div>
                <div className="max-w-sm overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                  <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    {form.avatar_url ? <img src={form.avatar_url} alt="" className="size-9 rounded-full object-cover" /> : <span className="grid size-9 place-items-center rounded-full bg-muted text-lg">✦</span>}
                    <div><p className="text-sm font-medium">{form.title || 'Chat with us'}</p><p className="text-xs text-muted-foreground">Your virtual assistant</p></div>
                  </div>
                  <div className="space-y-2 p-3 text-sm">
                    <p className="whitespace-pre-wrap">{form.greeting || 'Hi! 👋 How can we help you today?'}</p>
                    {form.suggested_questions.filter(Boolean).map((question, index) => <div key={index} className="rounded-lg border border-border px-3 py-2 text-xs">{question}</div>)}
                    <div className="flex items-center gap-2 pt-1"><span className="flex-1 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">Ask me anything...</span><span className="size-8 rounded-lg" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(form.accent_color) ? form.accent_color : '#128C7E' }} /></div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
                <div className="space-y-1"><Label htmlFor="widget-whatsapp-link">Show WhatsApp link</Label><p className="text-xs text-muted-foreground">Show the WhatsApp link at the bottom of the chat.</p></div>
                <Switch id="widget-whatsapp-link" checked={form.show_whatsapp_link} disabled={disabled} onCheckedChange={(checked) => update('show_whatsapp_link', checked)} />
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
                    Required when the widget is enabled. Use the number connected
                    to this account so website handoffs reach your inbox.
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
                  disabled={saving || uploading}
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
