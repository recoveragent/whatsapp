import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { reconcileCanvasNodes } from './canvas-node-state';

const node = (id: string, patch: Partial<Node> = {}): Node => ({
  id, type: 'flow', position: { x: 0, y: 0 }, data: {}, ...patch,
});

describe('reconcileCanvasNodes', () => {
  it('retains measurements needed by edges across repeated editor updates', () => {
    const measured = { width: 260, height: 90 };
    let current = [node('a', { measured, selected: true })];
    for (let i = 1; i <= 3; i++) {
      current = reconcileCanvasNodes(current, [node('a', {
        position: { x: i * 100, y: 20 }, data: { text: `Edit ${i}` },
      })]);
      expect(current[0].measured).toBe(measured);
      expect(current[0].selected).toBe(true);
      expect(current[0].position.x).toBe(i * 100);
      expect(current[0].data.text).toBe(`Edit ${i}`);
    }
  });

  it('drops removed nodes and measures new or replaced node types afresh', () => {
    const current = [node('removed'), node('changed', { measured: { width: 260, height: 90 } })];
    const derived = [node('new'), node('changed', { type: 'trigger' })];
    expect(reconcileCanvasNodes(current, derived)).toEqual(derived);
    expect(reconcileCanvasNodes(current, derived)[1].measured).toBeUndefined();
  });
});
