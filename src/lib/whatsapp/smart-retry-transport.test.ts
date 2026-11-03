import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaApiError } from './meta-api';
import { sendTemplateMessage } from './recoverable-template-send';
import { trackRecoverableTemplate } from './smart-retry';

vi.mock('./smart-retry', () => ({ trackRecoverableTemplate: vi.fn() }));

const args = {
  phoneNumberId: 'number',
  accessToken: 'secret-token',
  to: '919876543210',
  templateName: 'offer',
  language: 'en',
  params: ['Alice'],
};

describe('common template transport recovery integration', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.example');
    vi.mocked(trackRecoverableTemplate).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('captures the exact payload and wamid after a successful send without credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ messages: [{ id: 'wamid-accepted' }] }))
      )
    );
    const result = await sendTemplateMessage(args);
    expect(result.messageId).toBe('wamid-accepted');
    const sent = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(trackRecoverableTemplate).toHaveBeenCalledWith(
      args.phoneNumberId,
      sent,
      'wamid-accepted',
      undefined
    );
    expect(
      JSON.stringify(vi.mocked(trackRecoverableTemplate).mock.calls)
    ).not.toContain('secret-token');
  });

  it('captures immediate 131049 while preserving the caller-visible failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 131049, message: 'Marketing restriction' },
            }),
            { status: 400 }
          )
      )
    );
    await expect(sendTemplateMessage(args)).rejects.toBeInstanceOf(
      MetaApiError
    );
    expect(trackRecoverableTemplate).toHaveBeenCalledWith(
      'number',
      expect.any(Object),
      null,
      131049
    );
  });

  it('does not trigger recovery for another synchronous failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 131026, message: 'Undeliverable' },
            }),
            { status: 400 }
          )
      )
    );
    await expect(sendTemplateMessage(args)).rejects.toBeInstanceOf(
      MetaApiError
    );
    expect(trackRecoverableTemplate).not.toHaveBeenCalled();
  });

  it('does not turn successful delivery into a send error if recovery storage fails', async () => {
    vi.mocked(trackRecoverableTemplate).mockRejectedValue(
      new Error('Storage unavailable')
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ messages: [{ id: 'accepted' }] }))
      )
    );
    await expect(sendTemplateMessage(args)).resolves.toMatchObject({
      messageId: 'accepted',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
