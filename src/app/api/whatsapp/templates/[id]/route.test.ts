import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), edit: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
  toErrorResponse: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  editMessageTemplate: mocks.edit,
  deleteMessageTemplate: vi.fn(),
}))
import { PATCH } from './route'

const id = '11111111-1111-4111-8111-111111111111'
const payload = {
  name: 'renamed_draft', language: 'en_US', category: 'Utility',
  body_text: 'Your order is ready.',
}

function setup(status = 'DRAFT', metaId: string | null = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: {
      id, status, meta_template_id: metaId, name: 'old_name', language: 'en_US',
    } }),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id, ...payload, status: 'DRAFT' } }),
  }
  mocks.requireRole.mockResolvedValue({
    accountId: 'account-1', supabase: { from: vi.fn().mockReturnValue(query) },
  })
  return query
}

function patch(body = payload) {
  return PATCH(new Request('http://localhost/api/whatsapp/templates/' + id, {
    method: 'PATCH', body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })
}

describe('draft template editing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves renamed drafts in place without submitting to Meta', async () => {
    const query = setup()
    const response = await patch()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ draft: true })
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      name: payload.name, body_text: payload.body_text, submission_error: null,
    }))
    expect(query.eq).toHaveBeenCalledWith('id', id)
    expect(query.eq).toHaveBeenCalledWith('account_id', 'account-1')
    expect(query.eq).toHaveBeenCalledWith('status', 'DRAFT')
    expect(query.is).toHaveBeenCalledWith('meta_template_id', null)
    expect(mocks.edit).not.toHaveBeenCalled()
  })

  it('validates draft edits before saving', async () => {
    const query = setup()
    expect((await patch({ ...payload, name: 'Invalid name' })).status).toBe(400)
    expect(query.update).not.toHaveBeenCalled()
  })

  it('keeps pending templates locked', async () => {
    const query = setup('PENDING', 'meta-123')
    expect((await patch()).status).toBe(400)
    expect(query.update).not.toHaveBeenCalled()
    expect(mocks.edit).not.toHaveBeenCalled()
  })
})
