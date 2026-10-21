import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeDirectSendStatus,
  isDirectSendUnavailableError,
} from './direct-send';
import { recordDirectSendRejection } from './direct-send-store';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTextMessage } from './meta-api';
import { validateSendMessageParams } from './send-message';

afterEach(() => vi.unstubAllGlobals());
describe('Direct Send utility text', () => {
  it('adds category only when explicitly requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid-test' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const args = {
      phoneNumberId: 'phone',
      accessToken: 'token',
      to: '15551234567',
      text: 'Your order has shipped.',
    };
    await sendTextMessage({ ...args, category: 'utility' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      category: 'utility',
      type: 'text',
      text: { body: args.text },
    });
    await sendTextMessage(args);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty(
      'category'
    );
  });
  it.each([
    { category: 'marketing', messageType: 'text', contentText: 'Sale' },
    {
      category: 'utility',
      messageType: 'image',
      mediaUrl: 'https://example.com/a.png',
    },
    { category: 'utility', messageType: 'text', contentText: ' ' },
    { category: 'utility', messageType: 'text', contentText: 'x'.repeat(1025) },
  ])('rejects unsupported payloads before sending: %j', (params) => {
    expect(() => validateSendMessageParams(params)).toThrow(/Direct Send/);
  });
  it('accepts the utility text boundary', () => {
    expect(() =>
      validateSendMessageParams({
        category: 'utility',
        messageType: 'text',
        contentText: 'x'.repeat(1024),
      })
    ).not.toThrow();
  });
  it('surfaces Meta rejection without another delivery attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Not eligible', code: 100 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendTextMessage({
        phoneNumberId: 'phone',
        accessToken: 'token',
        to: '15551234567',
        text: 'Order shipped',
        category: 'utility',
      })
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Direct Send availability', () => {
  it.each([undefined, null, '', 'approved'])(
    'treats unconfirmed %s as unknown',
    (value) => {
      expect(normalizeDirectSendStatus(value)).toBe('unknown');
    }
  );
  it('recognizes the Meta eligibility rejection, but not network or policy errors', () => {
    expect(
      isDirectSendUnavailableError(
        "The 'category' value requires Direct Send, which isn't enabled for this account. Use an approved message template instead."
      )
    ).toBe(true);
    expect(isDirectSendUnavailableError('Network request failed')).toBe(false);
    expect(isDirectSendUnavailableError('Direct Send template is temporarily unavailable')).toBe(false);
    expect(
      isDirectSendUnavailableError(
        'Direct Send template paused due to low quality'
      )
    ).toBe(false);
  });
  it('records rejection only on the scoped config', async () => {
    const query = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: (value: { error: null }) => unknown) =>
        Promise.resolve(resolve({ error: null })),
    };
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    expect(
      await recordDirectSendRejection(
        db,
        'account-one',
        'config-one',
        "Direct Send isn't enabled for this account"
      )
    ).toBe(true);
    expect(query.update).toHaveBeenCalledWith({
      direct_send_status: 'unavailable',
    });
    expect(query.eq.mock.calls).toEqual([
      ['account_id', 'account-one'],
      ['id', 'config-one'],
    ]);
    vi.mocked(db.from).mockClear();
    expect(
      await recordDirectSendRejection(
        db,
        'account-one',
        'config-one',
        'Network request failed'
      )
    ).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
});
