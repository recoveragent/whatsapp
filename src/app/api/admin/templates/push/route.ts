// ============================================================
// /api/admin/templates/push — create one template across brands.
// ============================================================

import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { submitTemplateForAccount } from '@/lib/whatsapp/submit-template-for-account'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'

export interface BrandPushResult {
  brandId: string
  brandName: string
  ok: boolean
  status?: number
  error?: string
  metaTemplateId?: string
  templateId?: string | null
  dryRun?: boolean
  templateStatus?: string
}

/**
 * POST /api/admin/templates/push
 *
 * Super admin: validate a template once, then submit it to Meta for
 * each selected brand's WABA and persist a local message_templates row.
 */
export async function POST(request: Request) {
  try {
    const { organizationId, userId } = await requireSuperAdmin()

    const body = (await request.json().catch(() => null)) as {
      brandIds?: unknown
      template?: unknown
    } | null

    const brandIds = Array.isArray(body?.brandIds)
      ? [
          ...new Set(
            body.brandIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          ),
        ]
      : []

    if (brandIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one brand.' },
        { status: 400 },
      )
    }
    if (brandIds.length > 50) {
      return NextResponse.json(
        { error: 'You can push to at most 50 brands at once.' },
        { status: 400 },
      )
    }

    const payload = body?.template as TemplatePayload | undefined
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json(
        { error: 'Template payload is required.' },
        { status: 400 },
      )
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use Sync from Meta per brand.',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const admin = supabaseAdmin()

    const { data: brands, error: brandsError } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, organization_id')
      .in('id', brandIds)
      .eq('organization_id', organizationId)

    if (brandsError) {
      console.error('[POST /api/admin/templates/push]', brandsError)
      return NextResponse.json(
        { error: 'Failed to load brands' },
        { status: 500 },
      )
    }

    const brandById = new Map(
      (brands ?? []).map((b) => [b.id as string, b]),
    )

    const missing = brandIds.filter((id) => !brandById.has(id))
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'One or more brands were not found in your organization.' },
        { status: 403 },
      )
    }

    const results: BrandPushResult[] = []

    // Sequential on purpose — Meta rate-limits template creates per WABA,
    // and parallel fan-out across many brands can still trip app-level caps.
    for (const brandId of brandIds) {
      const brand = brandById.get(brandId)!
      const authorUserId =
        (brand.owner_user_id as string | null) ?? userId

      const result = await submitTemplateForAccount({
        supabase: admin,
        accountId: brandId,
        userId: authorUserId,
        payload,
      })

      if (result.ok) {
        results.push({
          brandId,
          brandName: brand.name as string,
          ok: true,
          metaTemplateId: result.metaTemplateId,
          templateId: result.templateId,
          dryRun: result.dryRun,
          templateStatus: result.status,
        })
      } else {
        results.push({
          brandId,
          brandName: brand.name as string,
          ok: false,
          status: result.status,
          error: result.error,
          metaTemplateId: result.metaTemplateId,
        })
      }
    }

    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded

    return NextResponse.json({
      success: failed === 0,
      succeeded,
      failed,
      results,
    })
  } catch (err) {
    console.error('[POST /api/admin/templates/push]', err)
    return toErrorResponse(err)
  }
}
