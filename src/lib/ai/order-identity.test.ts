import { describe, expect, it } from 'vitest';
import { aiOrderPhoneMatches } from './order-identity';

describe('AI order identity verification', () => {
  it.each(['+91 98765 43210', '9876543210', '09876543210', '9109876543210'])(
    'accepts a verified full or Indian domestic number: %s',
    (phone) => {
      expect(aiOrderPhoneMatches(phone, '919876543210')).toBe(true);
    }
  );
  it.each(['449876543210', '919976543210', '76543210', '', '111'])(
    'rejects fuzzy suffix matches: %s',
    (phone) => {
      expect(aiOrderPhoneMatches(phone, '919876543210')).toBe(false);
    }
  );
});
