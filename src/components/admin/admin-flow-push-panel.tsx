'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Globe,
  Loader2,
  Save,
  Trash2,
  Workflow,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import type { AdminFlowPresetView } from '@/lib/flows/admin-flow-preset-store';
import { slugifyFlowPresetName } from '@/lib/flows/clone-flow-snapshot';
import { cn } from '@/lib/utils';

interface BrandFlowOption {
  id: string;
  name: string;
  owner_user_id: string | null;
  flows: Array<{
    id: string;
    name: string;
    status: string;
    trigger_type: string;
    node_count: number;
    updated_at: string;
  }>;
}

interface PushResultRow {
  brandId: string;
  brandName: string;
  ok: boolean;
  error?: string;
  flowId?: string;
  flowName?: string;
}

function humanizeTrigger(type: string): string {
  return type.replace(/_/g, ' ');
}

export function AdminFlowPushPanel() {
  const { isSuperAdmin, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<BrandFlowOption[]>([]);
  const [presets, setPresets] = useState<AdminFlowPresetView[]>([]);
  const [sourceBrandId, setSourceBrandId] = useState('');
  const [sourceFlowId, setSourceFlowId] = useState('');
  const [selectedPresetSlug, setSelectedPresetSlug] = useState<string | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deployName, setDeployName] = useState('');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [galleryTitle, setGalleryTitle] = useState('');
  const [galleryDescription, setGalleryDescription] = useState('');
  const [gallerySlug, setGallerySlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<PushResultRow[] | null>(null);
  const didClearContext = useRef(false);

  const sourceBrand = brands.find((b) => b.id === sourceBrandId) ?? null;
  const sourceFlows = sourceBrand?.flows ?? [];
  const sourceFlow = sourceFlows.find((f) => f.id === sourceFlowId) ?? null;
  const activePreset =
    presets.find((p) => p.slug === selectedPresetSlug) ?? null;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/flows');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to load flows');
      const brandRows = (body.brands ?? []) as BrandFlowOption[];
      const presetRows = (body.presets ?? []) as AdminFlowPresetView[];
      setBrands(brandRows);
      setPresets(presetRows);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load flows');
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
      void loadData();
    } else {
      setLoading(false);
    }
  }, [isSuperAdmin, loadData, refreshProfile]);

  useEffect(() => {
    if (!sourceBrandId) {
      setSourceFlowId('');
      return;
    }
    if (!sourceFlows.some((f) => f.id === sourceFlowId)) {
      setSourceFlowId('');
    }
  }, [sourceBrandId, sourceFlowId, sourceFlows]);

  useEffect(() => {
    if (activePreset) {
      setDeployName(activePreset.flow_name);
    } else {
      setDeployName('');
    }
  }, [activePreset]);

  const toggleBrand = (brandId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return next;
    });
  };

  const toggleAllBrands = () => {
    if (selected.size === brands.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(brands.map((b) => b.id)));
  };

  const openSaveDialog = () => {
    if (!sourceFlow || !sourceBrand) return;
    setGalleryTitle(sourceFlow.name);
    setGalleryDescription('');
    setGallerySlug(slugifyFlowPresetName(sourceFlow.name));
    setSaveDialogOpen(true);
  };

  const handleSavePreset = async () => {
    if (!sourceFlow || !sourceBrand) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/flows/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId: sourceFlow.id,
          brandId: sourceBrand.id,
          brandName: sourceBrand.name,
          title: galleryTitle.trim(),
          description: galleryDescription.trim() || undefined,
          slug: gallerySlug.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to save global flow');

      setPresets((body.presets ?? []) as AdminFlowPresetView[]);
      const saved = body.preset as AdminFlowPresetView;
      setSelectedPresetSlug(saved.slug);
      setSaveDialogOpen(false);
      toast.success('Saved as global flow');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save global flow',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async (slug: string) => {
    const preset = presets.find((p) => p.slug === slug);
    if (!preset) return;
    const yes = window.confirm(
      `Delete global flow "${preset.title}"? This cannot be undone.`,
    );
    if (!yes) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/flows/presets/${slug}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed to delete preset');

      setPresets((body.presets ?? []) as AdminFlowPresetView[]);
      if (selectedPresetSlug === slug) setSelectedPresetSlug(null);
      toast.success('Global flow deleted');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete preset',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    if (!activePreset) {
      toast.error('Select a global flow first');
      return;
    }
    const brandIds = [...selected];
    if (brandIds.length === 0) {
      toast.error('Select at least one brand');
      return;
    }

    setPushing(true);
    setResults(null);
    try {
      const res = await fetch('/api/admin/flows/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetSlug: activePreset.slug,
          brandIds,
          name: deployName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Deploy failed');

      const rows = (body.results ?? []) as PushResultRow[];
      setResults(rows);

      if (body.failed === 0) {
        toast.success(
          `Flow duplicated to ${body.succeeded} brand${body.succeeded === 1 ? '' : 's'} as draft`,
        );
      } else {
        toast.message(
          `Duplicated to ${body.succeeded}, failed for ${body.failed}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setPushing(false);
    }
  };

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
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Save flow from a brand</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick any flow from any brand in your org and save it as a global
            preset you can deploy elsewhere.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Source brand</Label>
              <Select
                value={sourceBrandId || undefined}
                onValueChange={(val) => {
                  if (val) setSourceBrandId(val);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select brand…" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      {brand.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Source flow</Label>
              <Select
                value={sourceFlowId || undefined}
                onValueChange={(val) => {
                  if (val) setSourceFlowId(val);
                }}
                disabled={!sourceBrandId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select flow…" />
                </SelectTrigger>
                <SelectContent>
                  {sourceFlows.map((flow) => (
                    <SelectItem key={flow.id} value={flow.id}>
                      {flow.name} ({flow.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {sourceFlow ? (
            <p className="text-xs text-muted-foreground">
              {sourceFlow.node_count}{' '}
              {sourceFlow.node_count === 1 ? 'node' : 'nodes'} ·{' '}
              {humanizeTrigger(sourceFlow.trigger_type)} · {sourceFlow.status}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={openSaveDialog}
            disabled={!sourceFlow || saving}
          >
            <Globe className="size-4" />
            Save as global flow
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Global flows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No global flows yet. Save one from a brand above.
              </p>
            ) : (
              <div className="space-y-2">
                {presets.map((preset) => {
                  const isActive = selectedPresetSlug === preset.slug;
                  return (
                    <div
                      key={preset.slug}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3',
                        isActive
                          ? 'border-primary bg-primary/5'
                          : 'border-border',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPresetSlug(preset.slug)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="size-4 shrink-0 text-primary" />
                          <span className="truncate text-sm font-semibold">
                            {preset.title}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {preset.flow_name} · {preset.node_count}{' '}
                          {preset.node_count === 1 ? 'node' : 'nodes'} ·{' '}
                          {humanizeTrigger(preset.trigger_type)}
                        </p>
                        {preset.source_brand_name ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            From {preset.source_brand_name}
                          </p>
                        ) : null}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-red-400"
                        onClick={() => handleDeletePreset(preset.slug)}
                        disabled={saving}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {activePreset ? (
              <div className="space-y-2 border-t border-border pt-4">
                <Label>Flow name on target brands</Label>
                <Input
                  value={deployName}
                  onChange={(e) => setDeployName(e.target.value)}
                  placeholder={activePreset.flow_name}
                />
                <p className="text-[11px] text-muted-foreground">
                  Creates a draft on each selected brand. Review brand-specific
                  settings (tags, templates, pipelines) before activating.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Target brands</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleAllBrands}
                disabled={brands.length === 0}
              >
                {selected.size === brands.length ? 'Clear' : 'Select all'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {brands.map((brand) => (
                <label
                  key={brand.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selected.has(brand.id)}
                    onCheckedChange={() => toggleBrand(brand.id)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {brand.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {brand.flows.length}{' '}
                      {brand.flows.length === 1 ? 'flow' : 'flows'}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Button
            type="button"
            className="w-full"
            disabled={pushing || !activePreset || selected.size === 0}
            onClick={handleDeploy}
          >
            {pushing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              `Duplicate to ${selected.size || 0} brand${selected.size === 1 ? '' : 's'}`
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
                      <p className="font-medium">{row.brandName}</p>
                      {row.ok ? (
                        <p className="text-xs text-muted-foreground">
                          Draft · {row.flowName}
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
            <DialogTitle>Save as global flow</DialogTitle>
            <DialogDescription>
              This snapshot can be duplicated to any brand in your organization.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Gallery title</Label>
              <Input
                value={galleryTitle}
                onChange={(e) => {
                  setGalleryTitle(e.target.value);
                  if (!gallerySlug || gallerySlug === slugifyFlowPresetName(galleryTitle)) {
                    setGallerySlug(slugifyFlowPresetName(e.target.value));
                  }
                }}
                placeholder="e.g. COD recovery flow"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={gallerySlug}
                onChange={(e) =>
                  setGallerySlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                  )
                }
                placeholder="cod_recovery_flow"
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                value={galleryDescription}
                onChange={(e) => setGalleryDescription(e.target.value)}
                placeholder="Short note for your team"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSaveDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSavePreset}
              disabled={saving || !galleryTitle.trim() || !gallerySlug.trim()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Save className="size-4" />
                  Save global flow
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
