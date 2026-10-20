import { describe, expect, it } from 'vitest';
import { createRepairGate } from './repair-gate';

describe('thread repair scheduling', () => {
  it('coalesces long-running scans and applies cooldown only after success', () => {
    let now = 0;
    const gate = createRepairGate(() => now);
    expect(gate.start('brand:chat')).toBe(true);
    now = 120_000;
    expect(gate.start('brand:chat')).toBe(false);
    gate.finish('brand:chat', true);
    expect(gate.start('brand:chat')).toBe(false);
    now += 60_000;
    expect(gate.start('brand:chat')).toBe(true);
  });

  it('allows recovery after a failed scan and isolates accounts and chats', () => {
    const gate = createRepairGate();
    expect(gate.start('brand:chat')).toBe(true);
    expect(gate.start('other:chat')).toBe(true);
    expect(gate.start('brand:other')).toBe(true);
    gate.finish('brand:chat', false);
    expect(gate.start('brand:chat')).toBe(true);
  });
});
