import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChannelWorkspace {
  id: string;
  accountId: string;
  name: string;
  phoneNumberId: string;
  status: string;
  whatsappConfigId?: string | null;
}

export interface ChannelWorkspaceState {
  channels: ChannelWorkspace[];
  active: ChannelWorkspace | null;
  migrationRequired: boolean;
}

/** A channel is an account tenant underneath the brand, never a list filter. */
export async function loadChannelWorkspaces(
  db: SupabaseClient,
  brandAccountId: string,
  userId: string,
): Promise<ChannelWorkspaceState> {
  const { data: workspaces, error } = await db
    .from('accounts')
    .select('id')
    .eq('parent_brand_id', brandAccountId);

  if (error) {
    if (!['42703', 'PGRST204'].includes(error.code)) throw error;
    // Keep old single-number deployments usable. Never let a multiple-number
    // deployment masquerade as an isolated workspace before the migration.
    const legacy = await db.from('whatsapp_config')
      .select('id, account_id, reference_name, phone_number_id, status')
      .eq('account_id', brandAccountId).order('created_at');
    if (legacy.error) throw legacy.error;
    const channels = (legacy.data ?? []).map(toChannel);
    return { channels, active: channels.length === 1 ? channels[0] : null, migrationRequired: channels.length > 1 };
  }

  const ids = [brandAccountId, ...(workspaces ?? []).map((row) => row.id)];
  const result = await db.from('whatsapp_config')
    .select('id, account_id, reference_name, phone_number_id, status')
    .in('account_id', ids).order('created_at');
  if (result.error) throw result.error;
  const tenants = await db.from('accounts')
    .select('id, whatsapp_channel_name, channel_phone_number_id')
    .in('id', ids).not('whatsapp_channel_name', 'is', null).order('created_at');
  if (tenants.error) throw tenants.error;
  const channels: ChannelWorkspace[] = (tenants.data ?? []).map((tenant) => {
    const config = result.data?.find((row) => row.account_id === tenant.id);
    return { id: tenant.id, accountId: tenant.id, name: tenant.whatsapp_channel_name,
      phoneNumberId: config?.phone_number_id ?? tenant.channel_phone_number_id ?? '',
      status: config?.status ?? 'disconnected', whatsappConfigId: config?.id ?? null };
  });
  const context = await db.from('whatsapp_channel_context')
    .select('workspace_account_id').eq('user_id', userId)
    .eq('brand_account_id', brandAccountId).maybeSingle();
  if (context.error) throw context.error;
  return {
    channels,
    active: resolveActiveChannel(channels, context.data?.workspace_account_id),
    migrationRequired: false,
  };
}

export function resolveActiveChannel(channels: ChannelWorkspace[], selectedAccountId?: string | null) {
  if (selectedAccountId) return channels.find((channel) => channel.accountId === selectedAccountId) ?? null;
  return channels.length === 1 ? channels[0] : null;
}

/** Team membership belongs to the brand, while all operational data belongs to the workspace. */
export async function resolveBrandAccountId(db: SupabaseClient, workspaceId: string): Promise<string> {
  const result = await db.from('accounts').select('parent_brand_id').eq('id', workspaceId).maybeSingle();
  if (result.error && !['42703', 'PGRST204'].includes(result.error.code)) throw result.error;
  return result.data?.parent_brand_id ?? workspaceId;
}

function toChannel(row: { id: string; account_id: string; reference_name: string; phone_number_id: string; status: string }): ChannelWorkspace {
  return { id: row.id, accountId: row.account_id, name: row.reference_name, phoneNumberId: row.phone_number_id, status: row.status, whatsappConfigId: row.id };
}
