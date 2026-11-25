import { expect, it } from 'vitest';
import { TOOLS } from '@skaitch/core/mcp-tools';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';

it('exposes catalogue selection and opening directions for creation and updates', () => {
  const tools = Object.fromEntries(TOOLS.map(tool => [tool.name, tool]));
  expect(tools.list_opening_types).toBeDefined();
  for (const name of ['create_door', 'create_window', 'update_opening']) {
    expect(tools[name].inputSchema.properties).toMatchObject({
      catalogue_id: { type: 'string' },
      swing: { enum: ['left', 'right'] },
      side: { enum: [1, -1] },
    });
  }
  expect(BUILTIN_CATALOGUE.filter(def => def.type === 'Door').length).toBeGreaterThan(0);
  expect(BUILTIN_CATALOGUE.filter(def => def.type === 'Window').length).toBeGreaterThan(0);
});
