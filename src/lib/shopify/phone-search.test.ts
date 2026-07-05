import { describe, expect, it } from 'vitest';

import {
  shopifyCustomerSearchQueries,
  shopifyPhoneE164Variants,
  shopifyPhoneSearchVariants,
} from './phone-search';

describe('shopifyPhoneSearchVariants', () => {
  it('includes full and local variants for Indian WhatsApp numbers', () => {
    const variants = shopifyPhoneSearchVariants('918454048066');
    expect(variants).toContain('918454048066');
    expect(variants).toContain('8454048066');
  });
});

describe('shopifyPhoneE164Variants', () => {
  it('builds +91 E.164 for Indian numbers', () => {
    const variants = shopifyPhoneE164Variants('918454048066');
    expect(variants).toContain('+918454048066');
  });

  it('prepends +91 for 10-digit local numbers', () => {
    const variants = shopifyPhoneE164Variants('8454048066');
    expect(variants).toContain('+918454048066');
  });
});

describe('shopifyCustomerSearchQueries', () => {
  it('includes REST customer search phone queries', () => {
    const queries = shopifyCustomerSearchQueries('918454048066');
    expect(queries).toContain('phone:+918454048066');
    expect(queries).toContain('phone:8454048066');
  });
});
