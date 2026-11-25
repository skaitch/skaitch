import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
it('packages the pinned Node IFC WASM from a real path instead of a pnpm directory symlink', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  const file = resolve(config.functions['api/bim.ts'].includeFiles);
  expect(realpathSync(file)).toBe(file);
  expect([...readFileSync(file).subarray(0, 4)]).toEqual([0, 97, 115, 109]);
});
