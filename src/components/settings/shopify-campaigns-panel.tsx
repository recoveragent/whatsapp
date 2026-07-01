'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { ShopifyCampaignType, ShopifyVariableKey } from '@/lib/shopify/types';

interface CampaignDefinition {
  campaign_type: ShopifyCampaignType;
  name: string;
  description: string;
  suggested_variables: Record<string, ShopifyVariableKey>;
  default_delay_minutes?: number;
}

interface CampaignRow {
  id: string;
  campaign_type: ShopifyCampaignType;
  is_enabled: boolean;
  template_name: string | null;
  template_language: string;
  variable_mapping: Record<string, ShopifyVariableKey>;
  delay_minutes: number;
}

interface TemplateOption {
  name: string;
  language?: string;
  body_text: string;
}

const VARIABLE_LABELS: Record<ShopifyVariableKey, string> = {
  customer_name: 'Customer name',
  order_number: 'Order number',
  order_total: 'Order total',
  order_items: 'Line items',
  tracking_number: 'Tracking number',
  tracking_url: 'Tracking URL',
  checkout_url: 'Checkout URL',
  fulfillment_status: 'Fulfillment status',
  shop_name: 'Shop name',
};

export function ShopifyCampaignsPanel({
  canEdit,
  connected,
}: {
  canEdit: boolean;
  connected: boolean;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [definitions, setDefinitions] = useState<CampaignDefinition[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<CampaignRow>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shopify/campaigns', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load campaigns');

      setCampaigns(data.campaigns ?? []);
      setDefinitions(data.definitions ?? []);

      if (user) {
        const supabase = createClient();
        const { data: tpls } = await supabase
          .from('message_templates')
          .select('name, language, body_text')
          .eq('user_id', user.id)
          .eq('status', 'APPROVED')
          .order('name');
        setTemplates((tpls as TemplateOption[]) ?? []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load campaigns');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const getDraft = (row: CampaignRow): CampaignRow => ({
    ...row,
    ...drafts[row.campaign_type],
  });

  const updateDraft = (type: ShopifyCampaignType, patch: Partial<CampaignRow>) => {
    setDrafts((prev) => ({
      ...prev,
      [type]: { ...prev[type], ...patch },
    }));
  };

  const saveCampaign = async (type: ShopifyCampaignType) => {
    const row = campaigns.find((c) => c.campaign_type === type);
    if (!row) return;
    const draft = getDraft(row);

    setSaving(type);
    try {
      const res = await fetch('/api/shopify/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_type: type,
          is_enabled: draft.is_enabled,
          template_name: draft.template_name,
          template_language: draft.template_language,
          variable_mapping: draft.variable_mapping,
          delay_minutes: draft.delay_minutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setCampaigns((prev) =>
        prev.map((c) => (c.campaign_type === type ? data.campaign : c)),
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      toast.success('Campaign saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connected) {
    return (
      <Card className="border-border">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Connect your Shopify store first to configure WhatsApp campaigns.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">WhatsApp campaigns</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Map Shopify events to approved WhatsApp templates. Customers need a phone
          number on their order or checkout.
        </p>
      </div>

      {definitions.map((def) => {
        const row = campaigns.find((c) => c.campaign_type === def.campaign_type);
        if (!row) return null;
        const draft = getDraft(row);
        const mappingKeys = Object.keys({
          ...def.suggested_variables,
          ...draft.variable_mapping,
        }).sort((a, b) => Number(a) - Number(b));

        return (
          <Card key={def.campaign_type} className="border-border">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{def.name}</CardTitle>
                  <CardDescription className="mt-1">{def.description}</CardDescription>
                </div>
                <Switch
                  checked={draft.is_enabled}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    updateDraft(def.campaign_type, { is_enabled: checked })
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>WhatsApp template</Label>
                  <Select
                    value={draft.template_name ?? ''}
                    disabled={!canEdit}
                    onValueChange={(value) =>
                      updateDraft(def.campaign_type, { template_name: value || null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Template language</Label>
                  <Input
                    value={draft.template_language}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft(def.campaign_type, { template_language: e.target.value })
                    }
                    placeholder="en_US"
                  />
                </div>
              </div>

              {def.campaign_type === 'abandoned_checkout' && (
                <div className="space-y-2 max-w-xs">
                  <Label>Delay before sending (minutes)</Label>
                  <Input
                    type="number"
                    min={5}
                    max={10080}
                    value={draft.delay_minutes}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft(def.campaign_type, {
                        delay_minutes: Number(e.target.value) || 60,
                      })
                    }
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Template variables</Label>
                <div className="space-y-2">
                  {mappingKeys.map((index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-8 text-xs text-muted-foreground">{`{{${index}}}`}</span>
                      <Select
                        value={draft.variable_mapping?.[index] ?? ''}
                        disabled={!canEdit}
                        onValueChange={(value) =>
                          updateDraft(def.campaign_type, {
                            variable_mapping: {
                              ...draft.variable_mapping,
                              [index]: value as ShopifyVariableKey,
                            },
                          })
                        }
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Map to Shopify field" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(VARIABLE_LABELS).map(([key, label]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {canEdit && (
                <Button
                  size="sm"
                  disabled={saving === def.campaign_type}
                  onClick={() => void saveCampaign(def.campaign_type)}
                >
                  {saving === def.campaign_type ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="mr-1.5 size-4" />
                      Save campaign
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
