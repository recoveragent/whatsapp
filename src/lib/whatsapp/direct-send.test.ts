import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTextMessage } from './meta-api';
import { validateSendMessageParams } from './send-message';

afterEach(() => vi.unstubAllGlobals());
describe('Direct Send utility text', () => {
  it('adds category only when explicitly requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
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
