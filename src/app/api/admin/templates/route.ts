// ============================================================
// /api/admin/templates — brands ready for template push.
// ============================================================

import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { listOrganizationBrands } from '@/lib/auth/brand-accounts'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/admin/templates
 *
 * Lists org brands with WhatsApp readiness for the template push UI.
 * Uses the service-role client for whatsapp_config so ops can run
 * without switching into each brand.
 */
export async function GET() {
  try {
    const { supabase, organizationId } = await requireSuperAdmin()
    const { brands } = await listOrganizationBrands(supabase, organizationId)

    const admin = supabaseAdmin()
    const brandIds = brands.map((b) => b.id)
    const configByAccount = new Map<
      string,
      { waba_id: string | null; has_access_token: boolean }
    >()

    if (brandIds.length > 0) {
      const { data: configs, error } = await admin
        .from('whatsapp_config')
        .select('account_id, waba_id, access_token')
        .in('account_id', brandIds)

      if (error) {
        console.error('[GET /api/admin/templates]', error)
        return NextResponse.json(
          { error: 'Failed to load WhatsApp configs' },
          { status: 500 },
        )
      }

      for (const row of configs ?? []) {
        configByAccount.set(row.account_id as string, {
          waba_id: (row.waba_id as string | null) ?? null,
          has_access_token: Boolean(row.access_token),
        })
      }
    }

    return NextResponse.json({
      brands: brands.map((brand) => {
        const config = configByAccount.get(brand.id)
        const whatsappReady = Boolean(
          config?.waba_id && config.has_access_token,
        )
        return {
          id: brand.id,
          name: brand.name,
          owner_user_id: brand.owner_user_id,
          whatsapp_ready: whatsappReady,
          whatsapp_reason: !config
            ? 'not_configured'
            : !config.waba_id
              ? 'missing_waba'
              : !config.has_access_token
                ? 'missing_token'
                : null,
        }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
