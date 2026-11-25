import { describe, expect, it } from 'vitest';
import { itemsBarFamilies } from '@skaitch/ui/components/panels/ItemsBar';

const items = {
  s1: { id: 's1', type: 'Storey', name: 'RDC' },
  s2: { id: 's2', type: 'Storey', name: 'R+1' },
  w1: { id: 'w1', type: 'Wall', parentId: 's1' },
  w2: { id: 'w2', type: 'Wall', parentId: 's1' },
  d1: { id: 'd1', type: 'Door', parentId: 'w1' },
  c1: { id: 'c1', type: 'Dimension', parentId: 's1' },
  w3: { id: 'w3', type: 'Wall', parentId: 's2' },
  r3: { id: 'r3', type: 'Roof', parentId: 's2' },
} as any;

describe('items bar families', () => {
  it('counts the current storey only and drops empty types and families', () => {
    const f = itemsBarFamilies(items, 's1', new Set());
    expect(f.map(x => [x.id, x.count, x.types.map(t => t.type)])).toEqual([
      ['structure', 2, ['Wall']],
      ['openings', 1, ['Door']],
      ['annotations', 1, ['Dimension']],
    ]);
  });

  it('keeps a hidden type listed even when empty, and reports partial or full hiding', () => {
    const f = itemsBarFamilies(items, 's1', new Set(['Stair', 'Door']));
    const structure = f.find(x => x.id === 'structure')!;
    expect(structure.types.map(t => t.type)).toEqual(['Wall', 'Stair']);
    expect(structure.partial).toBe(true);
    expect(f.find(x => x.id === 'openings')!.hidden).toBe(true);
  });
});
