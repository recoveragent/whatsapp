import { describe, expect, it } from 'vitest';

import { slugifyFlowPresetName } from './clone-flow-snapshot';

describe('slugifyFlowPresetName', () => {
  it('normalizes names to snake_case slugs', () => {
    expect(slugifyFlowPresetName('COD Recovery Flow')).toBe('cod_recovery_flow');
    expect(slugifyFlowPresetName('  Hello!! World  ')).toBe('hello_world');
  });
});
