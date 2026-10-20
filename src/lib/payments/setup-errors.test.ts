import { describe, expect, it } from 'vitest';
import { paymentSetupError } from './setup-errors';

describe('payment deployment errors', () => {
  it('explains missing payment tables and schema-cache errors', () => {
    for (const error of [
      { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
      { code: '42P01', message: 'relation does not exist' },
      { message: 'public.account_payment_connections does not exist' },
    ]) {
      expect(paymentSetupError(error)).toContain('20261018113952_flow_collect_payment.sql');
    }
  });
  it('does not disguise authorization or unrelated server failures as missing setup', () => {
    for (const error of [null, new Error('Unknown failure'), { code: '42501' }, { code: '401' }]) {
      expect(paymentSetupError(error)).toBeNull();
    }
  });
});
