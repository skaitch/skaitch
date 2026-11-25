import { describe, expect, it } from 'vitest';
import { computeMcpModel } from '@skaitch/core/bim/mcpModel';
import { runBimOperation } from '@skaitch/core/bim/dispatch';
import { buildEmpty, buildStarter } from '@skaitch/core/data/starter';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { catalogueLabel, defaultName, nameLang, storeyName } from '@skaitch/core/lib/defaultNames';

const model = () => {
  const items = buildStarter();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const building = Object.values(items).find(i => i.type === 'Building')!;
  return { items, storey, building };
};
const added = (response: ReturnType<typeof computeMcpModel>) =>
  response.changes.find(change => change.kind === 'add')! as { kind: 'add'; item: any };

describe('default names follow the interface language', () => {
  const cases = [
    { lang: 'en', table: 'Dining table', storey: 'Level', wall: 'MCP wall', furniture: 'MCP furniture', room: 'MCP room' },
    { lang: 'fr', table: 'Table de repas', storey: 'Étage', wall: 'Mur MCP', furniture: 'Meuble MCP', room: 'Pièce MCP' },
    { lang: undefined, table: 'Table de repas', storey: 'Étage', wall: 'Mur MCP', furniture: 'Meuble MCP', room: 'Pièce MCP' },
  ];
  for (const expected of cases) {
    it(`names MCP elements in ${expected.lang ?? 'the French default'}`, () => {
      const { items, storey, building } = model();
      const run = (name: string, args: Record<string, unknown>) => computeMcpModel(name, args, items, storey.id, BUILTIN_CATALOGUE, expected.lang);

      const table = added(run('create_furniture', { catalogue_id: 'meuble-table-manger', point: [1, 1] })).item;
      expect([table.name, table.Name]).toEqual([expected.table, expected.table]);
      expect(added(run('create_furniture', { point: [1, 1] })).item.name).toBe(expected.furniture);

      const level = Object.values(items).filter(i => i.type === 'Storey' && i.parentId === building.id).length;
      const created = run('create_storey', { building_id: building.id });
      expect(created.result).toMatchObject({ success: true, name: `${expected.storey} ${level}` });
      expect(added(created).item.Name).toBe(`${expected.storey} ${level}`);

      expect(added(run('create_wall', { start_point: [0, 0], end_point: [4, 0] })).item.name).toBe(expected.wall);
      expect(added(run('create_space', { polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] })).item.name).toBe(expected.room);
    });
  }

  it('keeps explicit names whatever the language', () => {
    const { items, storey } = model();
    const response = computeMcpModel('create_furniture', { catalogue_id: 'meuble-table-manger', point: [1, 1], name: 'Kitchen table' }, items, storey.id, BUILTIN_CATALOGUE, 'fr');
    expect(added(response).item.name).toBe('Kitchen table');
  });

  it('threads the language through the BIM engine dispatch', async () => {
    const { items, storey } = model();
    const run = (lang?: string) => runBimOperation('mcp-model', {
      name: 'create_furniture', args: { catalogue_id: 'meuble-table-manger', point: [1, 1] },
      items, focusStorey: storey.id, catalogue: BUILTIN_CATALOGUE, ...(lang ? { lang } : {}),
    }) as Promise<ReturnType<typeof computeMcpModel>>;
    expect(added(await run('en')).item.name).toBe('Dining table');
    expect(added(await run('fr')).item.name).toBe('Table de repas');
    expect(added(await run()).item.name).toBe('Table de repas');
  });

  it('names the blank project building and storey in the interface language', () => {
    const names = (lang?: string) => Object.values(buildEmpty(lang)).filter(i => i.type !== 'Project').map(i => [i.type, i.name]);
    expect(names('en')).toEqual([['Building', 'Building'], ['Storey', 'Level 0']]);
    expect(names('fr')).toEqual([['Building', 'Bâtiment'], ['Storey', 'RDC']]);
    expect(names()).toEqual(names('fr'));
  });

  it('maps every interface language to French or English names', () => {
    expect(nameLang('fr')).toBe('fr');
    expect(nameLang('en')).toBe('en');
    expect(nameLang('de')).toBe('en');
    expect(nameLang('xx')).toBe('fr');
    expect(nameLang(undefined)).toBe('fr');
    expect(storeyName(2, 'en')).toBe('Level 2');
    expect(storeyName(2, 'fr')).toBe('Étage 2');
    expect(defaultName('wall', 'en')).toBe('Wall');
    expect(defaultName('wall', 'fr')).toBe('Mur');
    expect(catalogueLabel({ labelFr: 'Bureau perso', labelEn: '' }, 'en')).toBe('Bureau perso');
  });
});
