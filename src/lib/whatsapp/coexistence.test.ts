import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initiateSmbAppDataSync,
  isCoexistencePhone,
  listWabaPhoneNumbers,
  resolveCoexistencePhoneNumberId,
} from './meta-api';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isCoexistencePhone', () => {
  it('returns true for Cloud API + Business app numbers', () => {
    expect(
      isCoexistencePhone({
        id: '1',
        display_phone_number: '+1',
        is_on_biz_app: true,
        platform_type: 'CLOUD_API',
      }),
    ).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(
      isCoexistencePhone({
        id: '1',
        display_phone_number: '+1',
        is_on_biz_app: false,
        platform_type: 'CLOUD_API',
      }),
    ).toBe(false);
  });
});

describe('listWabaPhoneNumbers', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        data: [
          {
            id: 'PN_1',
            display_phone_number: '+15551234',
            is_on_biz_app: true,
            platform_type: 'CLOUD_API',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs /{waba_id}/phone_numbers with coexistence fields', async () => {
    const phones = await listWabaPhoneNumbers({
      wabaId: 'WABA_1',
      accessToken: 'tok',
    });
    expect(phones).toHaveLength(1);
    expect(phones[0]?.id).toBe('PN_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/WABA_1/phone_numbers');
    expect(url).toContain('is_on_biz_app');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
});

describe('resolveCoexistencePhoneNumberId', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefers the coexistence-flagged number', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          { id: 'OTHER', display_phone_number: '+1' },
          {
            id: 'COEX',
            display_phone_number: '+2',
            is_on_biz_app: true,
            platform_type: 'CLOUD_API',
          },
        ],
      }),
    );
    const id = await resolveCoexistencePhoneNumberId({
      wabaId: 'WABA_1',
      accessToken: 'tok',
    });
    expect(id).toBe('COEX');
  });

  it('falls back to the only number on the WABA', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [{ id: 'ONLY', display_phone_number: '+1' }],
      }),
    );
    const id = await resolveCoexistencePhoneNumberId({
      wabaId: 'WABA_1',
      accessToken: 'tok',
    });
    expect(id).toBe('ONLY');
  });
});

describe('initiateSmbAppDataSync', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      okResponse({ messaging_product: 'whatsapp', request_id: 'req_1' }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs smb_app_data with sync_type', async () => {
    const result = await initiateSmbAppDataSync({
      phoneNumberId: 'PN_1',
      accessToken: 'tok',
      syncType: 'history',
    });
    expect(result.request_id).toBe('req_1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/PN_1/smb_app_data');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'history',
    });
  });
});
