'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  Package,
  PenLine,
  Phone,
  Plus,
  RotateCcw,
  Save,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { AdminTemplatePresetIcon } from '@/lib/whatsapp/admin-template-presets';
import {
  editorSnapshotsEqual,
  presetToEditorSnapshot,
  presetViewToFormData,
  type AdminTemplatePresetPayload,
  type AdminTemplatePresetView,
  type PresetEditorSnapshot,
} from '@/lib/whatsapp/admin-template-preset-store';
import { cn } from '@/lib/utils';
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

const PRESET_ICONS: Record<
  AdminTemplatePresetIcon,
  ComponentType<{ className?: string }>
> = {
  shopping: ShoppingBag,
  package: Package,
  truck: Truck,
  cart: ShoppingCart,
  phone: Phone,
  custom: PenLine,
};

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

type TemplateFormData = AdminTemplatePresetPayload;

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Utility',
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
  const [presets, setPresets] = useState<AdminTemplatePresetView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  const [selectedPresetSlug, setSelectedPresetSlug] = useState<string | null>(
    null,
  );
  const [editorSnapshot, setEditorSnapshot] =
    useState<PresetEditorSnapshot | null>(null);
  const [galleryTitle, setGalleryTitle] = useState('');
  const [galleryDescription, setGalleryDescription] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newGalleryTitle, setNewGalleryTitle] = useState('');
  const [newGalleryDescription, setNewGalleryDescription] = useState('');
  const [pushing, setPushing] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
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
      const presetRows = (body.presets ?? []) as AdminTemplatePresetView[];
      setBrands(rows);
      setPresets(presetRows);
      setSelected(new Set());
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

  const applyPreset = (preset: AdminTemplatePresetView) => {
    const snapshot = presetToEditorSnapshot(preset);
    setSelectedPresetSlug(preset.slug);
    setForm(snapshot.form);
    setGalleryTitle(snapshot.title);
    setGalleryDescription(snapshot.description);
    setEditorSnapshot(snapshot);
    setResults(null);
  };

  const startCustomTemplate = () => {
    setSelectedPresetSlug(null);
    setForm(emptyForm);
    setGalleryTitle('');
    setGalleryDescription('');
    setEditorSnapshot(null);
    setResults(null);
  };

  const activePreset = selectedPresetSlug
    ? presets.find((p) => p.slug === selectedPresetSlug) ?? null
    : null;

  const currentEditorSnapshot = useMemo((): PresetEditorSnapshot => ({
    form,
    title: galleryTitle,
    description: galleryDescription,
  }), [form, galleryTitle, galleryDescription]);

  const isPresetDirty =
    activePreset !== null &&
    editorSnapshot !== null &&
    !editorSnapshotsEqual(currentEditorSnapshot, editorSnapshot);

  const canSaveAsNew =
    !activePreset &&
    form.name.trim().length > 0 &&
    form.body_text.trim().length > 0;

  const syncSavedPreset = (saved: AdminTemplatePresetView) => {
    const snapshot = presetToEditorSnapshot(saved);
    setPresets((prev) => {
      const exists = prev.some((p) => p.slug === saved.slug);
      if (exists) {
        return prev.map((p) => (p.slug === saved.slug ? saved : p));
      }
      return [...prev, saved];
    });
    setSelectedPresetSlug(saved.slug);
    setForm(snapshot.form);
    setGalleryTitle(snapshot.title);
    setGalleryDescription(snapshot.description);
    setEditorSnapshot(snapshot);
  };

  const handleSavePreset = async () => {
    if (!activePreset) return;
    setSavingPreset(true);
    try {
      const res = await fetch(
        `/api/admin/templates/presets/${activePreset.slug}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: galleryTitle,
            description: galleryDescription,
            payload: form,
            is_custom: activePreset.is_custom,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to save template');

      syncSavedPreset(body.preset as AdminTemplatePresetView);
      toast.success('Template saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingPreset(false);
    }
  };

  const openSaveAsNewDialog = () => {
    setNewGalleryTitle(
      form.name.trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    );
    setNewGalleryDescription('');
    setSaveDialogOpen(true);
  };

  const handleCreateCustomPreset = async () => {
    const slug = form.name.trim();
    const title = newGalleryTitle.trim();
    if (!slug || !title) {
      toast.error('Template name and gallery title are required');
      return;
    }

    setSavingPreset(true);
    try {
      const res = await fetch('/api/admin/templates/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          title,
          description: newGalleryDescription.trim() || undefined,
          payload: form,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to save template');

      syncSavedPreset(body.preset as AdminTemplatePresetView);
      setSaveDialogOpen(false);
      toast.success('Template saved to gallery');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleResetPreset = async () => {
    if (!activePreset || activePreset.is_custom) return;
    setSavingPreset(true);
    try {
      const res = await fetch(
        `/api/admin/templates/presets/${activePreset.slug}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to reset template');

      syncSavedPreset(body.preset as AdminTemplatePresetView);
      toast.success('Template reset to default');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reset template',
      );
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeleteCustomPreset = async () => {
    if (!activePreset?.is_custom) return;
    const yes = window.confirm(
      `Delete "${activePreset.title}" from the gallery? This cannot be undone.`,
    );
    if (!yes) return;

    setSavingPreset(true);
    try {
      const res = await fetch(
        `/api/admin/templates/presets/${activePreset.slug}`,
        { method: 'DELETE' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to delete template');

      setPresets((prev) => prev.filter((p) => p.slug !== activePreset.slug));
      startCustomTemplate();
      toast.success('Template deleted');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete template',
      );
    } finally {
      setSavingPreset(false);
    }
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
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Template library</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick a built-in or saved template, edit if needed, select brands,
            then push to Meta.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {presets.map((preset) => {
              const Icon = PRESET_ICONS[preset.icon] ?? FileText;
              const isActive = selectedPresetSlug === preset.slug;
              return (
                <button
                  key={preset.slug}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Icon className="size-5 shrink-0 text-primary" />
                    {preset.is_custom ? (
                      <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                        Custom
                      </span>
                    ) : preset.has_override ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        Edited
                      </span>
                    ) : null}
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {preset.title}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {preset.description}
                  </span>
                  <span className="mt-auto pt-2 font-mono text-[11px] text-muted-foreground">
                    {preset.name}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={startCustomTemplate}
              className={cn(
                'flex flex-col gap-2 rounded-lg border border-dashed p-4 text-left transition-colors',
                selectedPresetSlug === null && form.name === '' && form.body_text === ''
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background hover:border-primary/40 hover:bg-muted/50',
              )}
            >
              <PenLine className="size-5 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                Custom template
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Start from scratch with your own name, body, and buttons.
              </span>
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="border-border">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              {activePreset ? activePreset.title : 'Template details'}
            </CardTitle>
            {activePreset ? (
              <div className="flex shrink-0 items-center gap-2">
                {activePreset.is_custom ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteCustomPreset}
                    disabled={savingPreset}
                    className="text-red-500 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                ) : activePreset.has_override ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetPreset}
                    disabled={savingPreset}
                  >
                    {savingPreset ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                    Reset
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSavePreset}
                  disabled={savingPreset || !isPresetDirty}
                >
                  {savingPreset ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            ) : canSaveAsNew ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openSaveAsNewDialog}
                disabled={savingPreset}
              >
                {savingPreset ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save as template
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {activePreset && isPresetDirty ? (
              <p className="text-xs text-muted-foreground">
                You have unsaved changes to this template.
              </p>
            ) : null}
            {activePreset?.media_note ? (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {activePreset.media_note}
              </p>
            ) : null}
            {activePreset?.is_custom ? (
              <>
                <div className="space-y-2">
                  <Label>Gallery title</Label>
                  <Input
                    value={galleryTitle}
                    onChange={(e) => setGalleryTitle(e.target.value)}
                    placeholder="e.g. Weekend promo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gallery description (optional)</Label>
                  <Input
                    value={galleryDescription}
                    onChange={(e) => setGalleryDescription(e.target.value)}
                    placeholder="Short note for your team"
                  />
                </div>
              </>
            ) : null}
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. order_confirmation"
                required
                readOnly={Boolean(activePreset?.is_custom)}
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

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              Add this template to your gallery so you can reuse it later. The
              template name ({form.name.trim() || '…'}) becomes the Meta template
              ID.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Gallery title</Label>
              <Input
                value={newGalleryTitle}
                onChange={(e) => setNewGalleryTitle(e.target.value)}
                placeholder="e.g. Weekend promo"
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={newGalleryDescription}
                onChange={(e) => setNewGalleryDescription(e.target.value)}
                placeholder="Short note for your team"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSaveDialogOpen(false)}
              disabled={savingPreset}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateCustomPreset}
              disabled={
                savingPreset ||
                !newGalleryTitle.trim() ||
                !form.name.trim()
              }
            >
              {savingPreset ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Save template'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
