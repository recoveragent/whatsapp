/**
 * Meta Graph API calls for authoring WhatsApp Flows (forms):
 * create → upload flow.json → read validation errors → publish.
 *
 * A PUBLISHED Flow can't be edited; `publishFormToMeta` creates a fresh
 * Flow for each published revision and reuses a DRAFT Flow in place.
 *
 * All calls need the `whatsapp_business_management` permission on the
 * stored access token; Meta permission errors surface as
 * `MetaFlowsApiError` with `permission: true` and a reconnect hint.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi
 */

import { formatMetaErrorMessage, META_API_VERSION } from './meta-api'

const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export const FLOWS_PERMISSION_HINT =
  'Your WhatsApp access token is missing the whatsapp_business_management permission needed to create forms. Reconnect WhatsApp in Settings (granting WhatsApp Business management), or use a system user token with that permission.'

export class MetaFlowsApiError extends Error {
  readonly permission: boolean
  readonly code?: number
  constructor(message: string, opts: { permission?: boolean; code?: number } = {}) {
    super(message)
    this.name = 'MetaFlowsApiError'
    this.permission = !!opts.permission
    this.code = opts.code
  }
}

type MetaError = Parameters<typeof formatMetaErrorMessage>[0]

/** Meta: 10 / 200–299 permission denied, 190 token invalid. */
export function isMetaPermissionError(err: MetaError): boolean {
  const code = err.code ?? 0
  return code === 10 || code === 190 || (code >= 200 && code < 300) || /permission/i.test(err.message ?? '')
}

async function metaFetch<T>(url: string, init: RequestInit, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  })
  const data = (await response.json().catch(() => null)) as ({ error?: MetaError } & T) | null
  if (!response.ok || data?.error) {
    const err = data?.error
    if (err) {
      console.error('[meta-flows-api] request rejected:', JSON.stringify(err))
      const permission = isMetaPermissionError(err)
      const base = formatMetaErrorMessage(err)
      throw new MetaFlowsApiError(permission ? `${base} — ${FLOWS_PERMISSION_HINT}` : base, {
        permission,
        code: err.code,
      })
    }
    throw new MetaFlowsApiError(`Meta API error: ${response.status}`)
  }
  return data as T
}

export interface FlowValidationError {
  error: string
  error_type?: string
  message: string
  line_start?: number
  line_end?: number
  column_start?: number
  column_end?: number
}

export async function createWabaFlow(args: {
  wabaId: string
  accessToken: string
  name: string
  categories: string[]
}): Promise<{ id: string }> {
  const data = await metaFetch<{ id?: string }>(
    `${META_API_BASE}/${args.wabaId}/flows`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: args.name, categories: args.categories }),
    },
    args.accessToken,
  )
  if (!data.id) throw new MetaFlowsApiError('Meta did not return a Flow ID.')
  return { id: String(data.id) }
}

/** Upload (replace) a DRAFT Flow's flow.json. Returns Meta's validation errors. */
export async function uploadFlowJson(args: {
  flowId: string
  accessToken: string
  flowJson: unknown
}): Promise<FlowValidationError[]> {
  const form = new FormData()
  form.append('name', 'flow.json')
  form.append('asset_type', 'FLOW_JSON')
  form.append(
    'file',
    new Blob([JSON.stringify(args.flowJson)], { type: 'application/json' }),
    'flow.json',
  )
  const data = await metaFetch<{ validation_errors?: FlowValidationError[] }>(
    `${META_API_BASE}/${args.flowId}/assets`,
    { method: 'POST', body: form },
    args.accessToken,
  )
  return data.validation_errors ?? []
}

export async function getFlowStatus(args: {
  flowId: string
  accessToken: string
}): Promise<{ status: string; validation_errors: FlowValidationError[] }> {
  const data = await metaFetch<{ status?: string; validation_errors?: FlowValidationError[] }>(
    `${META_API_BASE}/${args.flowId}?fields=status,validation_errors`,
    { method: 'GET' },
    args.accessToken,
  )
  return { status: String(data.status ?? 'UNKNOWN'), validation_errors: data.validation_errors ?? [] }
}

export async function publishFlow(args: { flowId: string; accessToken: string }): Promise<void> {
  await metaFetch(`${META_API_BASE}/${args.flowId}/publish`, { method: 'POST' }, args.accessToken)
}

export interface PublishFormResult {
  flowId: string
  status: string
  /** True when a new Flow was created (first upload or editing a published one). */
  created: boolean
  validationErrors: FlowValidationError[]
}

/**
 * Push a form to Meta. Reuses `existingFlowId` while it is still DRAFT;
 * otherwise (published / deprecated / missing) creates a new Flow, since
 * Meta forbids editing a published Flow's JSON. With `publish: false` the
 * Flow is left as a DRAFT (sendable in draft mode for testing).
 */
export async function publishFormToMeta(args: {
  wabaId: string
  accessToken: string
  existingFlowId: string | null
  name: string
  categories: string[]
  flowJson: unknown
  publish: boolean
}): Promise<PublishFormResult> {
  const { accessToken } = args
  let flowId: string | null = null
  if (args.existingFlowId) {
    try {
      const current = await getFlowStatus({ flowId: args.existingFlowId, accessToken })
      if (current.status === 'DRAFT') flowId = args.existingFlowId
    } catch (err) {
      // Permission problems must surface; a deleted Flow just means "create anew".
      if (err instanceof MetaFlowsApiError && err.permission) throw err
    }
  }

  const created = !flowId
  if (!flowId) {
    flowId = (await createWabaFlow({ wabaId: args.wabaId, accessToken, name: args.name, categories: args.categories })).id
  }

  const uploadErrors = await uploadFlowJson({ flowId, accessToken, flowJson: args.flowJson })
  const after = await getFlowStatus({ flowId, accessToken })
  const validationErrors = uploadErrors.length > 0 ? uploadErrors : after.validation_errors
  if (validationErrors.length > 0 || !args.publish) {
    return { flowId, status: after.status, created, validationErrors }
  }

  await publishFlow({ flowId, accessToken })
  return { flowId, status: 'PUBLISHED', created, validationErrors: [] }
}
