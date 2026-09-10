import type { SupabaseClient } from '@supabase/supabase-js';

import { defaultCheckoutAppTriggerConfig } from '@/lib/flows/checkout-app-webhook';
import type { FlowTriggerType } from '@/lib/flows/trigger-types';
import { ensureFlowWebhookConfig } from '@/lib/flows/webhook-config';
import { generateWebhookToken } from '@/lib/automations/webhook-token';
import {
  ensureGoogleSheetRowConfig,
  type GoogleSheetRowTriggerConfig,
} from '@/lib/google-sheets/trigger-config';

export interface FlowNodeSnapshot {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
}

export interface FlowSnapshot {
  name: string;
  description: string | null;
  trigger_type: FlowTriggerType;
  trigger_config: Record<string, unknown>;
  entry_node_id: string;
  fallback_policy: unknown;
  exit_config: unknown;
  nodes: FlowNodeSnapshot[];
}

export function cloneTriggerConfigForCopy(
  triggerType: FlowTriggerType,
  triggerConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>;

  if (triggerType === 'webhook_received') {
    const ensured = ensureFlowWebhookConfig(cfg);
    return {
      ...ensured,
      webhook_token: generateWebhookToken(),
      last_received_payload: undefined,
      last_received_at: undefined,
    };
  }

  if (triggerType === 'shopify_checkout_app_abandoned') {
    const ensured = ensureFlowWebhookConfig({
      ...defaultCheckoutAppTriggerConfig(),
      ...cfg,
    });
    return {
      ...ensured,
      webhook_token: generateWebhookToken(),
      last_received_payload: undefined,
      last_received_at: undefined,
    };
  }

  if (triggerType === 'google_sheet_row') {
    const ensured = ensureGoogleSheetRowConfig(cfg);
    return {
      sources: ensured.sources.map(({ last_processed_row: _row, ...source }) => ({
        ...source,
      })),
    };
  }

  return cfg;
}

export async function loadFlowSnapshot(
  admin: SupabaseClient,
  flowId: string,
): Promise<FlowSnapshot | null> {
  const { data: flow, error: flowErr } = await admin
    .from('flows')
    .select(
      'name, description, trigger_type, trigger_config, entry_node_id, fallback_policy, exit_config',
    )
    .eq('id', flowId)
    .maybeSingle();

  if (flowErr) throw flowErr;
  if (!flow) return null;

  const { data: nodes, error: nodesErr } = await admin
    .from('flow_nodes')
    .select('node_key, node_type, config, position_x, position_y')
    .eq('flow_id', flowId)
    .order('created_at', { ascending: true });

  if (nodesErr) throw nodesErr;

  return {
    name: flow.name as string,
    description: (flow.description as string | null) ?? null,
    trigger_type: flow.trigger_type as FlowTriggerType,
    trigger_config: (flow.trigger_config as Record<string, unknown>) ?? {},
    entry_node_id: flow.entry_node_id as string,
    fallback_policy: flow.fallback_policy,
    exit_config: flow.exit_config,
    nodes: (nodes ?? []).map((n) => ({
      node_key: n.node_key as string,
      node_type: n.node_type as string,
      config: (n.config as Record<string, unknown>) ?? {},
      position_x: (n.position_x as number | null) ?? 0,
      position_y: (n.position_y as number | null) ?? 0,
    })),
  };
}

export async function insertFlowFromSnapshot(
  admin: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    snapshot: FlowSnapshot;
    name?: string;
    resetTriggers?: boolean;
  },
): Promise<{ id: string; name: string }> {
  const resetTriggers = params.resetTriggers !== false;
  const triggerConfig = resetTriggers
    ? cloneTriggerConfigForCopy(
        params.snapshot.trigger_type,
        params.snapshot.trigger_config,
      )
    : params.snapshot.trigger_config;

  const { data: copy, error: copyErr } = await admin
    .from('flows')
    .insert({
      account_id: params.accountId,
      user_id: params.userId,
      name: params.name?.trim() || params.snapshot.name,
      description: params.snapshot.description,
      status: 'draft',
      trigger_type: params.snapshot.trigger_type,
      trigger_config: triggerConfig,
      entry_node_id: params.snapshot.entry_node_id,
      fallback_policy: params.snapshot.fallback_policy,
      exit_config: params.snapshot.exit_config,
    })
    .select('id, name')
    .single();

  if (copyErr || !copy) {
    throw new Error(copyErr?.message ?? 'Failed to create flow copy');
  }

  if (params.snapshot.nodes.length > 0) {
    const { error: insErr } = await admin.from('flow_nodes').insert(
      params.snapshot.nodes.map((n) => ({
        flow_id: copy.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x,
        position_y: n.position_y,
      })),
    );
    if (insErr) {
      await admin.from('flows').delete().eq('id', copy.id);
      throw new Error(insErr.message);
    }
  }

  return { id: copy.id as string, name: copy.name as string };
}

export function slugifyFlowPresetName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return slug || 'flow_preset';
}
