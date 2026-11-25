import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PropertiesPane from '@skaitch/ui/components/panels/PropertiesPane';
import { buildStarter } from '@skaitch/core/data/starter';
import { LANGUAGES, makeT } from '@skaitch/core/data/i18n';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
}));

function controls(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(controls);
  if (!isValidElement(node)) return [];
  const element = node as any;
  if (typeof element.type === 'function') {
    if (!['Row', 'Row2', 'Section', 'Num', 'Select', 'Toggle', 'ReadOnly', 'DescriptionRow'].includes(element.type.name)) return [];
    return controls(element.type(element.props));
  }
  return [element, ...controls(element.props.children)];
}

function panel(id: string, lang = 'fr') {
  const items = buildStarter();
  const updateItem = vi.fn((key, patch) => { items[key] = { ...items[key], ...(typeof patch === 'function' ? patch(items[key]) : patch) }; });
  const tree = PropertiesPane({ items, selection: [id], updateItem, addItem: vi.fn(), deleteItems: vi.fn(), tool: 'select', setTool: vi.fn(), t: makeT(lang), lang, openSettings: vi.fn(), onCollapse: vi.fn() });
  return { items, updateItem, fields: controls(tree) };
}

describe('property editing', () => {
  it('keeps the exact door name editable instead of replacing it with its short label', () => {
    const starter = buildStarter();
    const door = Object.values(starter).find(i => i.type === 'Door')!;
    const { items, fields } = panel(door.id);
    const name = fields.find(e => e.type === 'input' && e.props.placeholder === makeT('fr')('Item name'));
    expect(name.props.value).toBe(door.name);
    name.props.onChange({ target: { value: 'Entrée principale' } });
    expect(items[door.id]).toMatchObject({ name: 'Entrée principale', Name: 'Entrée principale' });
  });

  it('synchronizes material and IFC metadata in a single update', () => {
    const wall = Object.values(buildStarter()).find(i => i.type === 'Wall')!;
    const { items, fields, updateItem } = panel(wall.id);
    const material = fields.find(e => e.type === 'select' && e.props.value === (wall as any).material);
    material.props.onChange({ target: { value: 'Pierre' } });
    expect(items[wall.id]).toMatchObject({ material: 'Pierre', Material: 'Pierre' });
    expect(updateItem).toHaveBeenCalledTimes(1);
  });

  it('commits decimal commas and rejects invalid or below-minimum dimensions', () => {
    const wall = Object.values(buildStarter()).find(i => i.type === 'Wall')!;
    const { items, fields } = panel(wall.id);
    const thickness = fields.find(e => e.type === 'input' && e.props.value === '0.20');
    expect(thickness).toBeDefined();
    thickness.props.onBlur({ currentTarget: { value: '0,35' } });
    expect((items[wall.id] as any).geom.thickness).toBe(.35);
    for (const value of ['', 'abc', '-1', 'Infinity']) thickness.props.onBlur({ currentTarget: { value } });
    expect((items[wall.id] as any).geom.thickness).toBe(.35);
  });

  it('provides editing handlers for every enabled input in starter property pages', () => {
    for (const item of Object.values(buildStarter())) {
      const { fields } = panel(item.id);
      for (const field of fields.filter(e => ['input', 'select', 'textarea'].includes(e.type))) {
        if (field.props.readOnly || field.props.disabled) continue;
        expect(typeof field.props.onChange, `${item.type}: ${field.props.value}`).toBe('function');
      }
    }
  });
});


describe('translated property options', () => {
  for (const { code } of LANGUAGES) {
    it(`translates room, material and opening lists in ${code} without changing saved values`, () => {
      const examples = [
        ['Room', 'Séjour', 'Living room'],
        ['Room', 'Salle de bain', 'Bathroom'],
        ['Wall', 'Brique 200mm', 'Brick 200mm'],
        ['Door', 'SLIDING', 'Sliding'],
        ['Window', 'FIXEDCASEMENT', 'Fixed'],
      ];
      for (const [type, value, key] of examples) {
        const item = Object.values(buildStarter()).find(i => i.type === type)!;
        const { fields, items } = panel(item.id, code);
        const option = fields.find(e => e.type === 'option' && e.props.value === value);
        expect(option, `${type}: ${value}`).toBeDefined();
        expect(option.props.children).toBe(makeT(code)(key));
        expect(items[item.id]).toEqual(item);
      }
    });
  }

  it('saves the existing room function value when choosing a translated label', () => {
    const room = Object.values(buildStarter()).find(i => i.type === 'Room')!;
    const { fields, items } = panel(room.id, 'en');
    const select = fields.find(e => e.type === 'select' && e.props.value === (room as any).function);
    select.props.onChange({ target: { value: 'Chambre' } });
    expect((items[room.id] as any).function).toBe('Chambre');
  });
});
