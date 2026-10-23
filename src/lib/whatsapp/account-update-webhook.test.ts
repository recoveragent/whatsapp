import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { handleAccountUpdateWebhookChange } from './account-update-webhook';
import { classifyMetaAccessError, MetaApiError } from './meta-api';

interface Config {
  id: string;
  account_id: string;
  waba_id: string;
  phone_number_id: string;
  access_token: string;
  status: string;
  meta_disconnected_at: string | null;
  meta_disconnect_reason?: string | null;
}

function makeDb(configs: Config[]) {
  const notifications: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: (_key: string, wabaId: string) => ({
              neq: () =>
                Promise.resolve({
                  data: configs.filter((c) => c.waba_id === wabaId && c.access_token !== ''),
                  error: null,
                }),
            }),
          }),
          update: (row: Partial<Config>) => ({
            eq: (_key: string, id: string) => ({
              is: () => ({
                select: () => {
                  const target = configs.find((c) => c.id === id && !c.meta_disconnected_at);
                  if (target) Object.assign(target, row);
                  return Promise.resolve({ data: target ? [{ id }] : [], error: null });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: (_key: string, id: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { id, parent_brand_id: null }, error: null }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: [{ user_id: 'owner-1' }, { user_id: 'admin-1' }],
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'notifications') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            notifications.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db: db as unknown as SupabaseClient, notifications };
}

const baseConfig = (): Config => ({
  id: 'cfg-1',
  account_id: 'acc-1',
  waba_id: 'WABA_1',
  phone_number_id: 'PN_1',
  access_token: 'enc',
  status: 'connected',
  meta_disconnected_at: null,
});

const revoked = () =>
  Promise.reject(
    new MetaApiError('Unsupported get request.', 400, { code: 100, error_subcode: 33 }),
  );

describe('classifyMetaAccessError', () => {
  it('treats missing objects, permissions and bad tokens as revoked access', () => {
    expect(classifyMetaAccessError(new MetaApiError('x', 400, { code: 100, error_subcode: 33 }))).toBe('access_revoked');
    expect(classifyMetaAccessError(new MetaApiError('x', 401, { code: 190 }))).toBe('access_revoked');
    expect(classifyMetaAccessError(new MetaApiError('x', 403, { code: 200 }))).toBe('access_revoked');
  });

  it('treats rate limits, generic errors and network failures as inconclusive', () => {
    expect(classifyMetaAccessError(new MetaApiError('x', 400, { code: 80008 }))).toBe('check_failed');
    expect(classifyMetaAccessError(new MetaApiError('x', 400, { code: 100 }))).toBe('check_failed');
    expect(classifyMetaAccessError(new MetaApiError('x', 500, { code: 2 }))).toBe('check_failed');
    expect(classifyMetaAccessError(new Error('fetch failed'))).toBe('check_failed');
  });
});

describe('handleAccountUpdateWebhookChange', () => {
  it('marks the number disconnected and alerts brand admins when our app is uninstalled', async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);

    await handleAccountUpdateWebhookChange(
      {
        entryId: 'WABA_1',
        value: {
          event: 'PARTNER_APP_UNINSTALLED',
          waba_info: { waba_id: 'WABA_1', partner_app_id: 'APP_1' },
        },
      },
      db,
      { appId: 'APP_1', confirmAccess: revoked, now: () => new Date('2026-10-23T06:32:00Z') },
    );

    expect(config).toMatchObject({
      status: 'disconnected',
      access_token: 'enc',
      meta_disconnected_at: '2026-10-23T06:32:00.000Z',
    });
    expect(config.meta_disconnect_reason).toContain('uninstalled');
    expect(notifications.map((n) => n.user_id)).toEqual(['owner-1', 'admin-1']);
    expect(notifications[0]).toMatchObject({
      account_id: 'acc-1',
      type: 'whatsapp_disconnected',
      title: 'WhatsApp number disconnected',
    });
  });

  it("includes Meta's coexistence removal reason", async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);

    await handleAccountUpdateWebhookChange(
      {
        entryId: 'WABA_1',
        value: { event: 'PARTNER_REMOVED', reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' },
      },
      db,
      { confirmAccess: revoked },
    );

    expect(config.meta_disconnect_reason).toContain('not opened for about 14 days');
    expect(String(notifications[0].body)).toContain('not opened for about 14 days');
  });

  it('alerts only once when Meta redelivers the event', async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);
    const change = { entryId: 'WABA_1', value: { event: 'ACCOUNT_OFFBOARDED' } };

    await handleAccountUpdateWebhookChange(change, db, { confirmAccess: revoked });
    await handleAccountUpdateWebhookChange(change, db, { confirmAccess: revoked });

    expect(notifications).toHaveLength(2);
  });

  it('ignores the event when Meta still grants access to the number', async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);

    await handleAccountUpdateWebhookChange(
      { entryId: 'WABA_1', value: { event: 'PARTNER_REMOVED' } },
      db,
      { confirmAccess: () => Promise.resolve({ id: 'PN_1' }) },
    );

    expect(config.status).toBe('connected');
    expect(notifications).toHaveLength(0);
  });

  it('does not act on an inconclusive access check', async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);

    await handleAccountUpdateWebhookChange(
      { entryId: 'WABA_1', value: { event: 'ACCOUNT_OFFBOARDED' } },
      db,
      { confirmAccess: () => Promise.reject(new MetaApiError('limit', 400, { code: 80008 })) },
    );

    expect(config.status).toBe('connected');
    expect(notifications).toHaveLength(0);
  });

  it("ignores uninstalls of another partner's app and unrelated events", async () => {
    const config = baseConfig();
    const { db, notifications } = makeDb([config]);
    const confirmAccess = vi.fn(revoked);

    await handleAccountUpdateWebhookChange(
      {
        entryId: 'WABA_1',
        value: { event: 'PARTNER_APP_UNINSTALLED', waba_info: { partner_app_id: 'OTHER' } },
      },
      db,
      { appId: 'APP_1', confirmAccess },
    );
    await handleAccountUpdateWebhookChange(
      { entryId: 'WABA_1', value: { event: 'VERIFIED_ACCOUNT' } },
      db,
      { appId: 'APP_1', confirmAccess },
    );

    expect(confirmAccess).not.toHaveBeenCalled();
    expect(config.status).toBe('connected');
    expect(notifications).toHaveLength(0);
  });
});
