import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}));

import { loadAiConfig } from './config';

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return chain as unknown as SupabaseClient;
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
};

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull();
  });

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    });
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('openai');
    expect(config!.apiKey).toBe('plain:enc-key');
  });

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false })
    ).toBeNull();
  });
  it('keeps chat requests on the chat model when a training model is set', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, training_model: 'gpt-6.1-sol' }),
      'acct',
      { requireActive: false }
    );
    expect(config!.model).toBe('gpt-x');
  });
  it('routes training to its own model with the same provider credentials', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, training_model: 'gpt-6.1-sol' }),
      'acct',
      { requireActive: false, purpose: 'training' }
    );
    expect(config!.model).toBe('gpt-6.1-sol');
    expect(config!.apiKey).toBe('plain:enc-key');
  });
  it.each([null, ''])(
    'falls back to the chat model when training model is %s',
    async (training_model) => {
      const config = await loadAiConfig(
        dbReturning({ ...ROW, training_model }),
        'acct',
        { requireActive: false, purpose: 'training' }
      );
      expect(config!.model).toBe('gpt-x');
    }
  );
});
