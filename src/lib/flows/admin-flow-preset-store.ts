import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getBuiltinAdminFlowPresetSnapshot,
  listBuiltinAdminFlowPresets,
} from './admin-flow-presets';
import {
  loadFlowSnapshot,
  slugifyFlowPresetName,
  type FlowSnapshot,
} from './clone-flow-snapshot';

export interface AdminFlowPresetView {
  slug: string;
  title: string;
  description: string;
  source_flow_id: string | null;
  source_brand_id: string | null;
  source_brand_name: string | null;
  node_count: number;
  trigger_type: string;
  flow_name: string;
  updated_at: string;
}

function parseSnapshot(raw: unknown): FlowSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.name !== 'string' || typeof body.trigger_type !== 'string') {
    return null;
  }
  if (!Array.isArray(body.nodes)) return null;
  return {
    name: body.name,
    description:
      typeof body.description === 'string'
        ? body.description
        : body.description === null
          ? null
          : null,
    trigger_type: body.trigger_type as FlowSnapshot['trigger_type'],
    trigger_config:
      body.trigger_config && typeof body.trigger_config === 'object'
        ? (body.trigger_config as Record<string, unknown>)
        : {},
    entry_node_id:
      typeof body.entry_node_id === 'string' ? body.entry_node_id : '',
    fallback_policy: body.fallback_policy ?? null,
    exit_config: body.exit_config ?? null,
    nodes: body.nodes
      .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
      .map((n) => ({
        node_key: String(n.node_key ?? ''),
        node_type: String(n.node_type ?? ''),
        config:
          n.config && typeof n.config === 'object'
            ? (n.config as Record<string, unknown>)
            : {},
        position_x: Number(n.position_x ?? 0),
        position_y: Number(n.position_y ?? 0),
      })),
  };
}

function rowToView(row: Record<string, unknown>): AdminFlowPresetView | null {
  const snapshot = parseSnapshot(row.payload);
  if (!snapshot) return null;
  return {
    slug: row.slug as string,
    title: (row.title as string).trim(),
    description: ((row.description as string | null) ?? '').trim(),
    source_flow_id: (row.source_flow_id as string | null) ?? null,
    source_brand_id: (row.source_brand_id as string | null) ?? null,
    source_brand_name: (row.source_brand_name as string | null) ?? null,
    node_count: snapshot.nodes.length,
    trigger_type: snapshot.trigger_type,
    flow_name: snapshot.name,
    updated_at: row.updated_at as string,
  };
}

export async function listAdminFlowPresets(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AdminFlowPresetView[]> {
  const { data, error } = await supabase
    .from('admin_flow_presets')
    .select(
      'slug, title, description, source_flow_id, source_brand_id, source_brand_name, payload, updated_at',
    )
    .eq('organization_id', organizationId)
    .order('title', { ascending: true });

  if (error) throw error;

  const saved = (data ?? [])
    .map((row) => rowToView(row as Record<string, unknown>))
    .filter((row): row is AdminFlowPresetView => row !== null);

  const savedSlugs = new Set(saved.map((row) => row.slug));
  const builtins = listBuiltinAdminFlowPresets()
    .filter((row) => !savedSlugs.has(row.slug))
    .map(({ builtin: _builtin, ...view }) => view);

  return [...builtins, ...saved].sort((a, b) => a.title.localeCompare(b.title));
}

export async function getAdminFlowPresetSnapshot(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<FlowSnapshot | null> {
  const builtin = getBuiltinAdminFlowPresetSnapshot(slug);
  if (builtin) return builtin;

  const { data, error } = await supabase
    .from('admin_flow_presets')
    .select('payload')
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return parseSnapshot(data.payload);
}

export async function createAdminFlowPresetFromFlow(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  input: {
    flowId: string;
    brandId: string;
    brandName: string;
    title: string;
    description?: string;
    slug?: string;
  },
): Promise<AdminFlowPresetView> {
  const title = input.title.trim();
  if (!title) throw new Error('Gallery title is required.');

  const { data: brand, error: brandErr } = await admin
    .from('accounts')
    .select('id, organization_id')
    .eq('id', input.brandId)
    .maybeSingle();

  if (brandErr) throw brandErr;
  if (!brand || brand.organization_id !== organizationId) {
    throw new Error('Brand not found in your organization.');
  }

  const { data: flow, error: flowErr } = await admin
    .from('flows')
    .select('id, account_id')
    .eq('id', input.flowId)
    .maybeSingle();

  if (flowErr) throw flowErr;
  if (!flow || flow.account_id !== input.brandId) {
    throw new Error('Flow not found for this brand.');
  }

  const snapshot = await loadFlowSnapshot(admin, input.flowId);
  if (!snapshot) throw new Error('Could not load flow snapshot.');

  const slug = (input.slug?.trim() || slugifyFlowPresetName(title)).slice(
    0,
    128,
  );

  const { data: existing } = await supabase
    .from('admin_flow_presets')
    .select('slug')
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .maybeSingle();

  if (existing) {
    throw new Error('A global flow with this slug already exists.');
  }

  const { error } = await supabase.from('admin_flow_presets').insert({
    organization_id: organizationId,
    slug,
    title,
    description: input.description?.trim() || null,
    source_flow_id: input.flowId,
    source_brand_id: input.brandId,
    source_brand_name: input.brandName,
    payload: snapshot,
    updated_by: userId,
  });

  if (error) throw error;

  const presets = await listAdminFlowPresets(supabase, organizationId);
  const created = presets.find((p) => p.slug === slug);
  if (!created) throw new Error('Failed to load saved preset.');
  return created;
}

export async function deleteAdminFlowPreset(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<void> {
  const { error } = await supabase
    .from('admin_flow_presets')
    .delete()
    .eq('organization_id', organizationId)
    .eq('slug', slug);

  if (error) throw error;
}
