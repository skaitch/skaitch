import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { importBimwiq } from '@skaitch/core/bim/importBimwiq';
import fixture from './fixtures/bimwiq.json';

it('allows imported BIMWIQ walls and rooms through the Canvas3D manual geometry gate', () => {
  const source = readFileSync(new URL('../../../../../packages/ui/src/components/canvas/Canvas3D.tsx', import.meta.url), 'utf8');
  const pattern = source.match(/const isManual = \(id: string\) => \/(.+)\/.test\(id\)/);
  expect(pattern).not.toBeNull();
  const acceptsId = new RegExp(pattern![1]);
  const geometry = Object.values(importBimwiq(fixture).items).filter(i => ['Wall', 'Room', 'Door', 'Window'].includes(i.type));
  expect(geometry).toHaveLength(64);
  expect(geometry.filter(i => !acceptsId.test(i.id)).map(i => i.id)).toEqual([]);
});
