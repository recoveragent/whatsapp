import type { Node } from '@xyflow/react';

/** Keep React Flow's measurements when editor data or positions change. */
export function reconcileCanvasNodes(current: Node[], derived: Node[]): Node[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  return derived.map((node) => {
    const previous = byId.get(node.id);
    if (!previous || previous.type !== node.type) return node;
    return { ...node, measured: previous.measured, selected: previous.selected };
  });
}
