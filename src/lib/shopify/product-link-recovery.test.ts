import { describe, expect, it } from 'vitest';

import {
  PRODUCT_LINK_RECOVERY_DELAY_DEFAULT,
  PRODUCT_LINK_RECOVERY_DELAY_MAX,
  PRODUCT_LINK_RECOVERY_DELAY_MIN,
} from './product-link-recovery';

describe('product link recovery constants', () => {
  it('uses a sensible default delay', () => {
    expect(PRODUCT_LINK_RECOVERY_DELAY_DEFAULT).toBe(60);
    expect(PRODUCT_LINK_RECOVERY_DELAY_MIN).toBeLessThan(
      PRODUCT_LINK_RECOVERY_DELAY_DEFAULT,
    );
    expect(PRODUCT_LINK_RECOVERY_DELAY_MAX).toBeGreaterThan(
      PRODUCT_LINK_RECOVERY_DELAY_DEFAULT,
    );
  });
});
