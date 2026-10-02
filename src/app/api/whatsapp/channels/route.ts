import { NextResponse } from 'next/server';
import { getCurrentBrandAccount, toErrorResponse } from '@/lib/auth/account';
import { loadChannelWorkspaces } from '@/lib/whatsapp/channel-workspace';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { importRecoverAgentShopifyConnection } from '@/lib/shopify/recover-agent-import';
import type { RecoverAgentShopifyConnection } from '@/lib/auth/sso';

export async function GET() {
  try {
    const ctx = await getCurrentBrandAccount();
    const state = await loadChannelWorkspaces(ctx.supabase, ctx.accountId, ctx.userId);
    return NextResponse.json({ ...state, brandAccountId: ctx.accountId }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentBrandAccount();
    const body = await request.json().catch(() => null);
    const state = await loadChannelWorkspaces(ctx.supabase, ctx.accountId, ctx.userId);
    if (state.migrationRequired) {
      return NextResponse.json({ error: 'Apply migrations 105 and 106 before selecting a channel.' }, { status: 409 });
    }
    const channel = state.channels.find((row) => row.id === body?.channelId);
    if (!channel) return NextResponse.json({ error: 'Channel not found in this brand.' }, { status: 404 });
    const { error } = await ctx.supabase.from('whatsapp_channel_context').upsert({
      user_id: ctx.userId, brand_account_id: ctx.accountId,
      workspace_account_id: channel.accountId,
    }, { onConflict: 'user_id,brand_account_id' });
    if (error) throw error;
    const pending = await supabaseAdmin().from('whatsapp_pending_shopify_imports')
      .delete().eq('user_id', ctx.userId).eq('brand_account_id', ctx.accountId)
      .select('encrypted_connection, webhook_callback_url').maybeSingle();
    if (pending.error) throw pending.error;
    if (pending.data) {
      try {
        await importRecoverAgentShopifyConnection({ sessionClient: ctx.supabase,
          connection: JSON.parse(decrypt(pending.data.encrypted_connection)) as RecoverAgentShopifyConnection,
          webhookCallbackUrl: pending.data.webhook_callback_url, workspaceAccountId: channel.accountId });
      } catch (importError) {
        console.error('[channels] pending Shopify import failed', importError);
        await supabaseAdmin().from('whatsapp_pending_shopify_imports').upsert({
          user_id: ctx.userId, brand_account_id: ctx.accountId, ...pending.data,
        }, { onConflict: 'user_id,brand_account_id', ignoreDuplicates: true });
        return NextResponse.json({ success: true, active: channel, nextUrl: '/settings?tab=shopify&channelImport=failed' });
      }
    }
    return NextResponse.json({ success: true, active: channel });
  } catch (error) { return toErrorResponse(error); }
}
