import { expect, it, vi } from 'vitest';
const confirmations = vi.hoisted(() => ({ capture: false, queue: [] as any[] }));
import { requestBim } from '../bimClient';
vi.mock('../bimClient', () => ({ requestBim: vi.fn(async (_operation: string, data: any) => {
  if (_operation === 'mcp-read') {
    const { readMcpModel } = await import('@skaitch/core/bim/mcpRead');
    return readMcpModel(data.name, data.args, data.items, data.catalogue);
  }
  const { computeMcpModel } = await import('@skaitch/core/bim/mcpModel');
  return computeMcpModel(data.name, data.args, data.items, data.focusStorey, data.catalogue);
}) }));
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { GENERATION_GUIDE } from '@skaitch/core/lib/generationGuide';
vi.mock('react', async () => ({
  ...await vi.importActual('react'),
  useEffect: () => {},
  useCallback: (fn: unknown) => fn,
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, (next: any) => {
    if (confirmations.capture && Array.isArray(value)) confirmations.queue = typeof next === 'function' ? next(confirmations.queue) : next;
  }],
}));
vi.mock('../firebase', () => ({ db: {} }));
import { useMcpBridge } from '../../hooks/useMcpBridge';

it.each([true, false])('makes the real catalogue available through legacy read tools (plan=%s)', async hasPlan => {
  const custom = { ...BUILTIN_CATALOGUE[0], id: 'project-door', source: 'project' as const };
  const catalogue = [...BUILTIN_CATALOGUE, custom];
  const { execute } = useMcpBridge({
    items: { s: { id: 's', type: 'Storey', name: 'Ground', geom: { plan: hasPlan ? { url: 'data:image/png;base64,test', x: 0, y: 0, scale: 0.01, w: 100, h: 100 } : undefined } } } as any,
    catalogue, focusStorey: 's', activeProjectId: 'p', uid: 'u',
    addItem: vi.fn(), updateItem: vi.fn(), deleteItems: vi.fn(),
  }, false);
  const plan = await execute('get_storey_floorplan', { storey_id: 's' }) as any;
  const scene = await execute('get_ifc_scene_overview', {}) as any;
  for (const result of [plan, scene]) {
    expect(result.catalogue).toEqual(catalogue);
    for (const id of ['door-garage-tilt-up', 'sdb-wc', 'sdb-vasque', 'sdb-douche', 'sdb-chauffe-eau', 'project-door']) {
      expect(result.catalogue.find((d: any) => d.id === id)?.defaults.width).toBeGreaterThan(0);
    }
  }
  expect(plan.calibration_help.generation_guidance).toBe(GENERATION_GUIDE);
  expect(scene.generation_guidance).toBe(GENERATION_GUIDE);
});

it('can generate selected catalogue models through legacy creation parameters alone', async () => {
  const addItem = vi.fn();
  const { execute } = useMcpBridge({
    items: { w: { id: 'w', type: 'Wall', parentId: 's', geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2 } } } as any,
    catalogue: BUILTIN_CATALOGUE, focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false,
    addItem, updateItem: vi.fn(), deleteItems: vi.fn(),
  }, false);
  const { catalogue } = await execute('get_ifc_scene_overview', {}) as any;
  for (const id of ['sdb-wc', 'sdb-vasque', 'sdb-douche', 'sdb-chauffe-eau']) {
    const def = catalogue.find((d: any) => d.id === id);
    const { width, depth, height } = def.defaults;
    const result = await execute('create_furniture', { model: id, category: def.category, name: def.labelFr,
      width, depth, height, point: [3 - width / 2, 2 - depth / 2], rotation: 0 }) as any;
    expect(result.success).toBe(true);
    const item = addItem.mock.lastCall![0];
    expect(item.model).toBe(id);
    expect(item.geom.x + item.geom.w / 2).toBeCloseTo(3);
    expect(item.geom.y + item.geom.d / 2).toBeCloseTo(2);
  }
  const garage = catalogue.find((d: any) => d.id === 'door-garage-tilt-up');
  expect(await execute('create_door', { wall_id: 'w', position: 0.5, width: garage.defaults.width,
    height: garage.defaults.height, operation_type: garage.defaults.OperationType })).toMatchObject({ success: true });
  expect(addItem.mock.lastCall![0].OperationType).toBe('TILT_UP');
  const win = catalogue.find((d: any) => d.id === 'win-fixed');
  expect(await execute('create_window', { wall_id: 'w', position: 0.5, width: win.defaults.width,
    height: win.defaults.height, operation_type: win.defaults.OperationType })).toMatchObject({ success: true });
  expect(addItem.mock.lastCall![0].OperationType).toBe('FIXED');
});

it('creates stairs through MCP and validates subsequent geometry updates against storeys',async()=>{
  const items:any={
    s:{id:'s',type:'Storey',geom:{elevation:0}},
    t:{id:'t',type:'Storey',geom:{elevation:3}},
  };
  const addItem=vi.fn((it:any)=>{items[it.id]=it;}),updateItem=vi.fn();
  const {execute}=useMcpBridge({items,catalogue:[],focusStorey:'s',activeProjectId:'p',uid:'u',alwaysValidate:false,addItem,updateItem,deleteItems:vi.fn()},false);
  const created=await execute('create_stair',{geometry:{targetId:'t',form:'half',width:1.1}}) as any;
  expect(created.success).toBe(true);
  expect(items[created.id].geom.form).toBe('half');
  expect(await execute('update_element',{id:created.id,geometry:{form:'spiral',count:20}})).toHaveProperty('success',true);
  expect(updateItem.mock.lastCall![1].geom.count).toBe(20);
  expect(await execute('update_element',{id:created.id,geometry:{targetId:'s'}})).toHaveProperty('error');
  expect(await execute('create_stair',{geometry:{targetId:'t',width:-1}})).toHaveProperty('error');
  expect(addItem).toHaveBeenCalledTimes(1);
});

it('creates, updates and deletes roofs and stairs through the shared AI tools', async () => {
  const items: any = { s: { id: 's', type: 'Storey', geom: { elevation: 0 } }, t: { id: 't', type: 'Storey', geom: { elevation: 3 } } };
  const addItem = vi.fn((item: any) => { items[item.id] = item; });
  const updateItem = vi.fn((id: string, patch: any) => { Object.assign(items[id], patch); });
  const deleteItems = vi.fn();
  const { execute } = useMcpBridge({ items, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false, addItem, updateItem, deleteItems }, false);
  const roof = await execute('create_roof', { geometry: { polygon: [[0,0],[6,0],[6,4],[0,4]], roofType: 'gable' } }) as any;
  expect(roof.success).toBe(true);
  expect(await execute('update_element', { id: roof.id, geometry: { roofType: 'custom', ridgeSwap: true, edges: Array.from({ length: 4 }, () => ({ gable: false, pitch: 35 })) } })).toHaveProperty('success', true);
  expect(items[roof.id].PredefinedType).toBe('FREEFORM');
  expect(await execute('update_element', { id: roof.id, geometry: { pitch: -1 } })).toHaveProperty('error');
  expect(await execute('create_roof', { geometry: { polygon: [[0,0],[1,1],[2,2]] } })).toHaveProperty('error');
  const stair = await execute('create_stair', { geometry: { targetId: 't' } }) as any;
  expect(stair.success).toBe(true);
  expect(await execute('update_element', { id: stair.id, geometry: { width: 1.2 } })).toHaveProperty('success', true);
  expect(await execute('delete_element', { ids: [roof.id, stair.id] })).toMatchObject({ success: true, deleted_count: 2 });
  expect(deleteItems).toHaveBeenCalledWith([roof.id, stair.id]);
});


it('creates, reads, adjusts and deletes saved section planes through shared AI tools', async () => {
  const items: any = { s: { id: 's', type: 'Storey', ifcType: 'IfcBuildingStorey', geom: { elevation: 0 } } };
  const addItem = vi.fn((item: any) => { items[item.id] = item; });
  const updateItem = vi.fn((id: string, patch: any) => { Object.assign(items[id], patch); });
  const deleteItems = vi.fn();
  const { execute } = useMcpBridge({ items, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false, addItem, updateItem, deleteItems }, false);
  const created = await execute('create_section', { name: 'Coupe A', geometry: { x1: 2, y1: 3, x2: 8, y2: 3, depth: 7 } }) as any;
  expect(created.success).toBe(true);
  const id = created.id;
  expect(items[id].geom).toMatchObject({ x1: 2, y1: 3, x2: 8, y2: 3 });
  expect(items[id]).toMatchObject({ type: 'Section', parentId: 's', name: 'Coupe A', geom: { origin: [2, 0, -3], normal: [0, 0, 1], depth: 7 } });
  expect(await execute('list_ifc_entities', { ifc_type: 'IfcAnnotation' })).toEqual([expect.objectContaining({ id })]);
  expect(await execute('get_element_properties', { id })).toBe(items[id]);
  expect(await execute('update_element', { id, properties: { name: 'Coupe B' }, geometry: { origin: [4, 2, -5], normal: [0, 3, 4], depth: 12 } })).toHaveProperty('success', true);
  expect(items[id]).toMatchObject({ Name: 'Coupe B', geom: { origin: [4, 2, -5], depth: 12 } });
  expect(items[id].geom.normal[1]).toBeCloseTo(0.6);
  expect(items[id].geom.normal[2]).toBeCloseTo(0.8);
  expect(await execute('update_element', { id, geometry: { x1: 6, y1: 7, x2: 6, y2: 9 } })).toHaveProperty('success', true);
  expect(items[id].geom).toMatchObject({ origin: [6, 2, -7], normal: [1, 0, 0], depth: 12 });
  expect(await execute('update_element', { id, geometry: { depth: 8 } })).toHaveProperty('success', true);
  expect(items[id].geom.origin).toEqual([6, 2, -7]);
  const horizontal = await execute('create_section', { geometry: { origin: [0, 3, 0], normal: [0, 1, 0] } }) as any;
  expect(horizontal.success).toBe(true);
  expect(items[horizontal.id].geom.normal).toEqual([0, 1, 0]);
  const before = structuredClone(items[id]);
  for (const geometry of [{ normal: [0, 0, 0] }, { origin: [1, 2] }, { depth: 0 }, { depth: -1 }, { depth: Infinity }, { normal: [0, NaN, 1] }, { x1: 6, y1: 7, x2: 6, y2: 7 }, { x1: 2, origin: [0, 0, 0] }]) {
    expect(await execute('update_element', { id, geometry })).toHaveProperty('error');
    expect(items[id]).toEqual(before);
  }
  for (const geometry of [{}, { origin: [0, 0, 0] }, { x1: 0, y1: 0, x2: 0, y2: 0 }, { origin: [0,0,0], normal: [0,0,0] }]) {
    expect(await execute('create_section', { geometry })).toHaveProperty('error');
  }
  expect(await execute('create_section', { storey_id: 'missing', geometry: { origin: [0,0,0], normal: [1,0,0] } })).toHaveProperty('error');
  expect(addItem).toHaveBeenCalledTimes(2);
  expect(await execute('delete_element', { ids: [id] })).toMatchObject({ success: true, deleted_count: 1 });
  expect(deleteItems).toHaveBeenCalledWith([id]);
});

it('delegates view controls and captures without mutating project elements', async () => {
  const getView = vi.fn(() => ({ view: '2d', scale: 50 }));
  const setView = vi.fn(async args => ({ success: true, ...args }));
  const captureView = vi.fn(async () => ({ image_url: 'data:image/jpeg;base64,YWJj', view: '3d' }));
  const addItem = vi.fn(), updateItem = vi.fn(), deleteItems = vi.fn();
  const { execute } = useMcpBridge({ items: {}, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: true, addItem, updateItem, deleteItems, getView, setView, captureView }, false);
  expect(await execute('get_view', {})).toMatchObject({ scale: 50 });
  const args = { view: '3d', all_storeys: true, zoom_factor: 2 };
  expect(await execute('set_view', args)).toMatchObject({ success: true, ...args });
  expect(setView).toHaveBeenCalledWith(args);
  expect(await execute('capture_view', {})).toHaveProperty('image_url');
  captureView.mockRejectedValueOnce(new Error('Capture unavailable'));
  expect(await execute('capture_view', {})).toEqual({ error: 'Capture unavailable' });
  expect(addItem).not.toHaveBeenCalled(); expect(updateItem).not.toHaveBeenCalled(); expect(deleteItems).not.toHaveBeenCalled();
});


it('does not apply a server result after the editor model changes', async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(requestBim).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }) as any);
  const addItem = vi.fn();
  const handlers = { items: {}, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false, addItem, updateItem: vi.fn(), deleteItems: vi.fn() };
  const { execute } = useMcpBridge(handlers, false);
  const pending = execute('create_marker', { point: [0, 0] });
  handlers.items = { new: { id: 'new' } };
  complete({ result: { success: true }, changes: [{ kind: 'add', item: { id: 'stale' } }] });
  await expect(pending).rejects.toThrow('Le projet a changé');
  expect(addItem).not.toHaveBeenCalled();
});


it('honors server-required confirmation even if the browser setting is off, and defers deletions', async () => {
  confirmations.capture = true; confirmations.queue = [];
  vi.mocked(requestBim).mockClear();
  const deleteItems = vi.fn();
  const { execute } = useMcpBridge({ items: { s: { id: 's', type: 'Storey', geom: { elevation: 0 } } } as any,
    catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false,
    addItem: vi.fn(), updateItem: vi.fn(), deleteItems }, false);
  const pending = execute('delete_storey', { storey_id: 's' }, true);
  expect(confirmations.queue).toHaveLength(1);
  expect(requestBim).not.toHaveBeenCalled();
  expect(deleteItems).not.toHaveBeenCalled();
  await confirmations.queue[0].resolve();
  expect(await pending).toMatchObject({ success: true, deleted_ids: ['s'] });
  expect(deleteItems).toHaveBeenCalledWith(['s']);
  confirmations.capture = false;
});

it('rejects a confirmation after project selection changes', async () => {
  confirmations.capture = true; confirmations.queue = [];
  const deleteItems = vi.fn();
  const handlers = { items: { s: { id: 's', type: 'Storey', geom: { elevation: 0 } } } as any,
    catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: true,
    addItem: vi.fn(), updateItem: vi.fn(), deleteItems };
  const { execute } = useMcpBridge(handlers, false);
  const pending = execute('delete_storey', { storey_id: 's' });
  handlers.activeProjectId = 'other';
  await confirmations.queue[0].resolve();
  await expect(pending).rejects.toThrow();
  expect(deleteItems).not.toHaveBeenCalled();
  confirmations.capture = false;
});

it('approves a server render without generating a browser-side preview or changing selection', async () => {
  confirmations.capture = true; confirmations.queue = [];
  vi.mocked(requestBim).mockClear();
  const setSelection = vi.fn(), addItem = vi.fn();
  const { execute } = useMcpBridge({ items: { p: { id: 'p', type: 'Project' } } as any, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: false, addItem, updateItem: vi.fn(), deleteItems: vi.fn(), setSelection }, false);
  const pending = execute('generate_visualization', { prompt: 'House' }, true, Date.now() + 60_000, true);
  expect(confirmations.queue).toHaveLength(1);
  expect(requestBim).not.toHaveBeenCalled();
  expect(setSelection).not.toHaveBeenCalled();
  expect(addItem).not.toHaveBeenCalled();
  await confirmations.queue[0].resolve();
  expect(await pending).toEqual({ approved: true });
  confirmations.capture = false;
});

it.each(['create_roof', 'update_element'])('restores attached walls when a %s preview is rejected', async name => {
  confirmations.capture = true; confirmations.queue = [];
  const items: any = {
    s: { id: 's', type: 'Storey', geom: { elevation: 0 } },
    wall: { id: 'wall', type: 'Wall', ifcType: 'IfcWall', parentId: 's', geom: { x1: 1, y1: 1, x2: 5, y2: 1, thickness: 0.2, height: 2.5 } },
  };
  const geometry = { polygon: [[0, 0], [6, 0], [6, 4], [0, 4]], roofType: 'flat', elevation: 3, thickness: 0.25 };
  if (name === 'update_element') items.roof = { id: 'roof', GlobalId: 'roof-global', type: 'Roof', ifcType: 'IfcRoof', parentId: 's', geom: { ...geometry, elevation: 4 } };
  const before = structuredClone(items);
  const addItem = vi.fn((item: any) => { items[item.id] = item; });
  const updateItem = vi.fn((id: string, patch: any) => { Object.assign(items[id], patch); });
  const deleteItems = vi.fn((ids: string[]) => { ids.forEach(id => delete items[id]); });
  const { execute } = useMcpBridge({ items, catalogue: [], focusStorey: 's', activeProjectId: 'p', uid: 'u', alwaysValidate: true, addItem, updateItem, deleteItems }, false);
  try {
    const pending = execute(name, { id: 'roof', geometry, attach_walls: true });
    const rejected = expect(pending).rejects.toThrow('Refus');
    await vi.waitFor(() => expect(confirmations.queue).toHaveLength(1));
    expect(items.wall.geom.roofId).toBeDefined();
    confirmations.queue[0].reject('Refus');
    await rejected;
    expect(items.wall.geom).toEqual(before.wall.geom);
    expect(Object.keys(items).sort()).toEqual(Object.keys(before).sort());
    if (before.roof) expect(items.roof.geom).toEqual(before.roof.geom);
  } finally { confirmations.capture = false; confirmations.queue = []; }
});
