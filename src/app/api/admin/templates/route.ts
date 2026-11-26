// ============================================================
// /api/admin/templates — brands ready for template push.
// ============================================================

import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { listOrganizationBrands } from '@/lib/auth/brand-accounts'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { listAdminTemplatePresets } from '@/lib/whatsapp/admin-template-presets'
import { listMergedAdminTemplatePresets } from '@/lib/whatsapp/admin-template-preset-store'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface BrandTemplateOption {
  id: string
  name: string
  category: string
  language: string
  status: string | null
  header_type: string | null
  header_content: string | null
  header_media_url: string | null
  body_text: string
  footer_text: string | null
  buttons: unknown[]
  sample_values: { body?: string[]; header?: string[] } | null
}

/**
 * GET /api/admin/templates
 *
 * Lists org brands with WhatsApp readiness and their existing templates
 * (so any brand template can be saved to the global gallery).
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

    const templatesByBrand = new Map<string, BrandTemplateOption[]>()
    if (brandIds.length > 0) {
      const { data: templateRows, error: templatesErr } = await admin
        .from('message_templates')
        .select(
          'id, account_id, name, category, language, status, header_type, header_content, header_media_url, body_text, footer_text, buttons, sample_values, created_at',
        )
        .in('account_id', brandIds)
        .order('created_at', { ascending: false })

      if (templatesErr) {
        console.error('[GET /api/admin/templates] templates', templatesErr)
      } else {
        for (const row of templateRows ?? []) {
          const brandId = row.account_id as string
          const list = templatesByBrand.get(brandId) ?? []
          list.push({
            id: row.id as string,
            name: row.name as string,
            category: row.category as string,
            language: (row.language as string | null) ?? 'en_US',
            status: (row.status as string | null) ?? null,
            header_type: (row.header_type as string | null) ?? null,
            header_content: (row.header_content as string | null) ?? null,
            header_media_url: (row.header_media_url as string | null) ?? null,
            body_text: (row.body_text as string | null) ?? '',
            footer_text: (row.footer_text as string | null) ?? null,
            buttons: Array.isArray(row.buttons) ? row.buttons : [],
            sample_values:
              row.sample_values && typeof row.sample_values === 'object'
                ? (row.sample_values as BrandTemplateOption['sample_values'])
                : null,
          })
          templatesByBrand.set(brandId, list)
        }
      }
    }

    let presets
    try {
      presets = await listMergedAdminTemplatePresets(supabase, organizationId)
    } catch (presetErr) {
      console.error('[GET /api/admin/templates] presets fallback:', presetErr)
      presets = listAdminTemplatePresets().map((preset) => ({
        ...preset,
        has_override: false,
        is_custom: false,
      }))
    }

    return NextResponse.json({
      presets,
      brands: brands.map((brand) => {
        const config = configByAccount.get(brand.id)
        const whatsappReady = Boolean(
          config?.waba_id && config.has_access_token,
        )
        return {
          id: brand.id,
          name: brand.name,
          owner_user_id: brand.owner_user_id,
          templates: templatesByBrand.get(brand.id) ?? [],
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
