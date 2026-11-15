import { describe, expect, it } from 'vitest';
import { maskSecret } from './mask-secret';

describe('maskSecret', () => {
  it('shows only the last two characters of a saved secret', () => {
    expect(maskSecret('secret1234')).toBe('********34');
    expect(maskSecret('ab')).toBe('********');
    expect(maskSecret('')).toBe('');
  });
});
