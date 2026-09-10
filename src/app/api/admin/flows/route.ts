// ============================================================
// /api/admin/flows — brands, source flows, and global presets.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { listOrganizationBrands } from '@/lib/auth/brand-accounts';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  listAdminFlowPresets,
  type AdminFlowPresetView,
} from '@/lib/flows/admin-flow-preset-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * GET /api/admin/flows
 *
 * Super admin: list org brands, flows per brand, and saved global presets.
 */
export async function GET() {
  try {
    const { supabase, organizationId } = await requireSuperAdmin();
    const { brands } = await listOrganizationBrands(supabase, organizationId);
    const admin = supabaseAdmin();
    const brandIds = brands.map((b) => b.id);

    const flowsByBrand: Record<
      string,
      Array<{
        id: string;
        name: string;
        status: string;
        trigger_type: string;
        node_count: number;
        updated_at: string;
      }>
    > = {};

    if (brandIds.length > 0) {
      const { data: flows, error: flowsErr } = await admin
        .from('flows')
        .select('id, account_id, name, status, trigger_type, updated_at')
        .in('account_id', brandIds)
        .order('updated_at', { ascending: false });

      if (flowsErr) {
        console.error('[GET /api/admin/flows] flows', flowsErr);
        return NextResponse.json(
          { error: 'Failed to load flows' },
          { status: 500 },
        );
      }

      const flowIds = (flows ?? []).map((f) => f.id as string);
      const nodeCountByFlow = new Map<string, number>();

      if (flowIds.length > 0) {
        const { data: nodeRows, error: nodesErr } = await admin
          .from('flow_nodes')
          .select('flow_id')
          .in('flow_id', flowIds);

        if (nodesErr) {
          console.error('[GET /api/admin/flows] nodes', nodesErr);
          return NextResponse.json(
            { error: 'Failed to load flow nodes' },
            { status: 500 },
          );
        }

        for (const row of nodeRows ?? []) {
          const flowId = row.flow_id as string;
          nodeCountByFlow.set(flowId, (nodeCountByFlow.get(flowId) ?? 0) + 1);
        }
      }

      for (const flow of flows ?? []) {
        const brandId = flow.account_id as string;
        if (!flowsByBrand[brandId]) flowsByBrand[brandId] = [];
        flowsByBrand[brandId].push({
          id: flow.id as string,
          name: flow.name as string,
          status: flow.status as string,
          trigger_type: flow.trigger_type as string,
          node_count: nodeCountByFlow.get(flow.id as string) ?? 0,
          updated_at: flow.updated_at as string,
        });
      }
    }

    let presets: AdminFlowPresetView[] = [];
    try {
      presets = await listAdminFlowPresets(supabase, organizationId);
    } catch (presetErr) {
      console.error('[GET /api/admin/flows] presets fallback:', presetErr);
    }

    return NextResponse.json({
      brands: brands.map((brand) => ({
        id: brand.id,
        name: brand.name,
        owner_user_id: brand.owner_user_id,
        flows: flowsByBrand[brand.id] ?? [],
      })),
      presets,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
