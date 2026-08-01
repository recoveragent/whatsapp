'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useAuth } from '@/hooks/use-auth';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';
import type { MessageTemplate, TemplateButton, TemplateSampleValues } from '@/types';

const CATEGORIES = ['Marketing', 'Utility'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = [
  'none',
  'text',
  'image',
  'video',
  'document',
];

const COMMON_LANGUAGE_CODES = [
  'en_US',
  'en_GB',
  'en',
  'es',
  'es_ES',
  'fr',
  'de',
  'pt_BR',
  'hi',
];

interface BrandOption {
  id: string;
  name: string;
  owner_user_id: string | null;
  whatsapp_ready: boolean;
  whatsapp_reason: string | null;
}

interface PushResultRow {
  brandId: string;
  brandName: string;
  ok: boolean;
  error?: string;
  metaTemplateId?: string;
  dryRun?: boolean;
  templateStatus?: string;
}

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

function reasonLabel(reason: string | null): string {
  switch (reason) {
    case 'not_configured':
      return 'WhatsApp not configured';
    case 'missing_waba':
      return 'Missing WABA ID';
    case 'missing_token':
      return 'Missing access token';
    default:
      return 'Not ready';
  }
}

export function AdminTemplatePushPanel() {
  const { isSuperAdmin, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<PushResultRow[] | null>(null);
  const didClearContext = useRef(false);

  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );
  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';

  useEffect(() => {
    setForm((prev) => {
      const next = [...prev.body_samples];
      while (next.length < bodyVarCount) next.push('');
      if (next.length > bodyVarCount) next.length = bodyVarCount;
      if (
        next.length === prev.body_samples.length &&
        next.every((v, i) => v === prev.body_samples[i])
      ) {
        return prev;
      }
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  const loadBrands = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/templates');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to load brands');
      const rows = (body.brands ?? []) as BrandOption[];
      setBrands(rows);
      setSelected(
        new Set(rows.filter((b) => b.whatsapp_ready).map((b) => b.id)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load brands');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      if (!didClearContext.current) {
        didClearContext.current = true;
        void fetch('/api/admin/brands/clear-context', { method: 'POST' })
          .then(() => refreshProfile())
          .catch(() => undefined);
      }
      void loadBrands();
    } else {
      setLoading(false);
    }
  }, [isSuperAdmin, loadBrands, refreshProfile]);

  const readyBrands = brands.filter((b) => b.whatsapp_ready);
  const allReadySelected =
    readyBrands.length > 0 && readyBrands.every((b) => selected.has(b.id));

  const toggleAllReady = () => {
    if (allReadySelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(readyBrands.map((b) => b.id)));
  };

  function buildPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type:
        form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  const handlePush = async (e: React.FormEvent) => {
    e.preventDefault();
    const brandIds = [...selected];
    if (brandIds.length === 0) {
      toast.error('Select at least one brand with WhatsApp connected');
      return;
    }

    setPushing(true);
    setResults(null);
    try {
      const res = await fetch('/api/admin/templates/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandIds,
          template: buildPayload(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Push failed');

      const rows = (body.results ?? []) as PushResultRow[];
      setResults(rows);

      if (body.failed === 0) {
        toast.success(
          `Template submitted to ${body.succeeded} brand${body.succeeded === 1 ? '' : 's'}`,
        );
      } else {
        toast.message(
          `Submitted to ${body.succeeded}, failed for ${body.failed}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };

  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const next = [...prev.buttons];
      const current = next[index];
      if (!current) return prev;
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  if (!isSuperAdmin) {
    return (
      <Card className="max-w-lg border-border">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Super admin access required.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <form onSubmit={handlePush} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              Template
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. order_confirmation"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Lowercase letters, digits, and underscores only.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) => {
                    if (!val) return;
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Input
                  list="admin-template-language-codes"
                  value={form.language}
                  onChange={(e) =>
                    setForm({ ...form, language: e.target.value })
                  }
                  placeholder="en_US"
                />
                <datalist id="admin-template-language-codes">
                  {COMMON_LANGUAGE_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Header</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) => {
                  if (!val) return;
                  setForm({
                    ...form,
                    header_format: val as HeaderFormat,
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type === 'none'
                        ? 'None'
                        : type.charAt(0).toUpperCase() + type.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' ? (
                <div className="mt-2 space-y-2">
                  <Input
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    placeholder="Header text (optional {{1}})"
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                  />
                  {headerVarCount > 0 ? (
                    <Input
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      placeholder="Sample for {{1}}"
                    />
                  ) : null}
                </div>
              ) : null}

              {headerNeedsMedia ? (
                <div className="mt-2 space-y-2">
                  <Input
                    value={form.header_media_url}
                    onChange={(e) =>
                      setForm({ ...form, header_media_url: e.target.value })
                    }
                    placeholder={`Public HTTPS ${form.header_format} URL`}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Paste a publicly reachable HTTPS link. Meta fetches it
                    during review for each brand.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Body</Label>
              <Textarea
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                placeholder="Hello {{1}}, your order {{2}} is confirmed."
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                required
              />
              {bodyVarCount > 0 ? (
                <div className="space-y-1.5 pt-1">
                  <Label className="text-[11px] text-muted-foreground">
                    Sample values
                  </Label>
                  {form.body_samples.map((val, i) => (
                    <Input
                      key={i}
                      value={val}
                      onChange={(e) => {
                        const next = [...form.body_samples];
                        next[i] = e.target.value;
                        setForm({ ...form, body_samples: next });
                      }}
                      placeholder={`Sample for {{${i + 1}}}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Footer (optional)</Label>
              <Input
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                placeholder="Optional footer"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Buttons (optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) {
                      return;
                    }
                    setForm((prev) => ({
                      ...prev,
                      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
                    }));
                  }}
                  disabled={
                    form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal
                  }
                >
                  <Plus className="size-3" />
                  Add
                </Button>
              </div>
              {form.buttons.map((btn, i) => (
                <div
                  key={i}
                  className="space-y-2 rounded-md border border-border bg-muted/40 p-2"
                >
                  <div className="flex items-center gap-2">
                    <Select
                      value={btn.type}
                      onValueChange={(val) => {
                        if (!val) return;
                        setForm((prev) => {
                          const next = [...prev.buttons];
                          next[i] = emptyButton(
                            val as TemplateButton['type'],
                          );
                          return { ...prev, buttons: next };
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="QUICK_REPLY">Quick Reply</SelectItem>
                        <SelectItem value="URL">URL</SelectItem>
                        <SelectItem value="PHONE_NUMBER">Phone</SelectItem>
                        <SelectItem value="COPY_CODE">Copy Code</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-8 text-muted-foreground hover:text-red-400"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          buttons: prev.buttons.filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <Input
                    value={btn.text}
                    onChange={(e) => updateButton(i, { text: e.target.value })}
                    placeholder="Button text"
                    maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                  />
                  {btn.type === 'URL' ? (
                    <Input
                      value={btn.url}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                      placeholder="https://…"
                    />
                  ) : null}
                  {btn.type === 'PHONE_NUMBER' ? (
                    <Input
                      value={btn.phone_number}
                      onChange={(e) =>
                        updateButton(i, { phone_number: e.target.value })
                      }
                      placeholder="+91…"
                    />
                  ) : null}
                  {btn.type === 'COPY_CODE' ? (
                    <Input
                      value={btn.example}
                      onChange={(e) =>
                        updateButton(i, { example: e.target.value })
                      }
                      placeholder="Sample code"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Brands</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleAllReady}
                disabled={readyBrands.length === 0}
              >
                {allReadySelected ? 'Clear' : 'Select ready'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {brands.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No brands yet. Create one under Brands first.
                </p>
              ) : (
                brands.map((brand) => {
                  const checked = selected.has(brand.id);
                  return (
                    <label
                      key={brand.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 ${
                        brand.whatsapp_ready
                          ? 'hover:bg-muted/50'
                          : 'cursor-not-allowed opacity-60'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!brand.whatsapp_ready}
                        onCheckedChange={(value) => {
                          if (!brand.whatsapp_ready) return;
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (value === true) next.add(brand.id);
                            else next.delete(brand.id);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {brand.name}
                        </span>
                        {!brand.whatsapp_ready ? (
                          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <AlertCircle className="size-3 shrink-0" />
                            {reasonLabel(brand.whatsapp_reason)}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            WhatsApp connected
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full"
            disabled={pushing || selected.size === 0}
          >
            {pushing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              `Create on ${selected.size || 0} brand${selected.size === 1 ? '' : 's'}`
            )}
          </Button>

          {results ? (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-base">Results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {results.map((row) => (
                  <div
                    key={row.brandId}
                    className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    {row.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {row.brandName}
                      </p>
                      {row.ok ? (
                        <p className="text-xs text-muted-foreground">
                          {row.dryRun ? 'Dry-run · ' : ''}
                          {row.templateStatus ?? 'PENDING'}
                          {row.metaTemplateId
                            ? ` · ${row.metaTemplateId}`
                            : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-red-500">{row.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </form>
  );
}
