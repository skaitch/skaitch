import { expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { renameProjectItems } from '@skaitch/core/lib/projectName';

it('renames the IFC project without changing other entities or the original model', () => {
  const items = buildEmpty();
  const renamed = renameProjectItems(items, 'Test Plan 2');
  const project = Object.values(items).find(item => item.type === 'Project')!;
  expect(renamed[project.id]).toMatchObject({ name: 'Test Plan 2', Name: 'Test Plan 2' });
  expect(items[project.id]).toBe(project);
  expect(renamed[project.id]).not.toBe(project);
  for (const item of Object.values(items).filter(item => item.type !== 'Project')) {
    expect(renamed[item.id]).toBe(item);
  }
});
