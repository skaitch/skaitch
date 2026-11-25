/**
 * Round-trip tests for patchIFC.
 *
 * Each element type (Wall, Door, Window, Room/pièce, Slab/dalle) is exercised
 * in three scenarios:
 *   Create  – new item in ItemsMap → new STEP entity injected before ENDSEC
 *   Update  – existing item with changed geometry → entity patched in-place
 *   Delete  – item removed from ItemsMap → entity representation nulled ($)
 *
 * Every delete test also verifies that all other fixture elements are preserved.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { patchIFC } from '@skaitch/core/bim/patchIFC';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import type { ItemsMap } from '@skaitch/core/types/ifc';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function splitArgs(str: string): string[] {
  const result: string[] = [];
  let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === "'" && str[i + 1] !== "'") inStr = false;
      else if (c === "'") i++;
    } else if (c === "'" ) {
      inStr = true;
    } else if (c === '(' || c === '[') {
      depth++;
    } else if (c === ')' || c === ']') {
      depth--;
    } else if (c === ',' && depth === 0) {
      result.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(str.slice(start).trim());
  return result;
}

interface StepEntity { type: string; args: string[] }

function parseStep(text: string): Map<number, StepEntity> {
  const map = new Map<number, StepEntity>();
  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\((.*)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null)
    map.set(parseInt(m[1], 10), { type: m[2], args: splitArgs(m[3]) });
  return map;
}

function entitiesOfType(map: Map<number, StepEntity>, type: string): [number, StepEntity][] {
  return [...map.entries()].filter(([, e]) => e.type === type);
}

function cartesianPointTuple(map: Map<number, StepEntity>, id: number): number[] {
  const ent = map.get(id);
  expect(ent?.type, `#${id} must be an IFCCARTESIANPOINT`).toBe('IFCCARTESIANPOINT');
  return ent!.args.join(',').replace(/[()]/g, '').split(',').map((v) => Number.parseFloat(v));
}

// arg[5] and arg[6] both '$' means the entity has been "deleted" (representation nulled)
const isNulled  = (e: StepEntity) => e.args.length >= 7 && e.args[5] === '$' && e.args[6] === '$';
const hasGeom   = (e: StepEntity) => e.args.length >= 7 && e.args[5] !== '$' && e.args[6] !== '$';
// For existing elements patchIFC only updates placement (arg[5]), leaving representation (arg[6]) intact.
const isNewPlacement = (e: StepEntity, origRepRef: string) =>
  e.args[5]?.startsWith('#') && parseInt(e.args[5].slice(1)) > FIXTURE_MAX_ID && e.args[6] === origRepRef;

// ── Fixture ───────────────────────────────────────────────────────────────────
// A minimal valid IFC4 STEP file with known expressIDs:
//   #10  = storey  (arg[5]=#11 = storey placement)
//   #100 = IFCWALL
//   #200 = IFCDOOR
//   #300 = IFCWINDOW
//   #400 = IFCSPACE  (room/pièce)
//   #500 = IFCSLAB   (dalle)
//   #600 = IFCCOLUMN (extra element — must always be preserved)
// Max expressID = 619 → newly injected entities get IDs ≥ 620.
const FIXTURE_MAX_ID = 619;

const FIXTURE_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('SkAItch unit test'),'2;1');
FILE_NAME('test.ifc','2024-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#2,$);
#2=IFCAXIS2PLACEMENT3D(#3,$,$);
#3=IFCCARTESIANPOINT((0.,0.,0.));
#10=IFCBUILDINGSTOREY('storey-guid-001',$,'GF',$,$,#11,$,$,.NOTDEFINED.,0.);
#11=IFCLOCALPLACEMENT($,#12);
#12=IFCAXIS2PLACEMENT3D(#13,$,$);
#13=IFCCARTESIANPOINT((0.,0.,0.));
#100=IFCWALL('wall-guid-100',$,'Wall1',$,$,#101,#102,$,$);
#101=IFCLOCALPLACEMENT(#11,#103);
#102=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#104));
#103=IFCAXIS2PLACEMENT3D(#105,$,$);
#104=IFCEXTRUDEDAREASOLID(#106,#107,#108,3.0);
#105=IFCCARTESIANPOINT((0.,0.,0.));
#106=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#109);
#107=IFCAXIS2PLACEMENT3D(#110,$,$);
#108=IFCDIRECTION((0.,0.,1.));
#109=IFCPOLYLINE((#111,#112,#113,#111));
#110=IFCCARTESIANPOINT((0.,0.,0.));
#111=IFCCARTESIANPOINT((-0.1,-0.1));
#112=IFCCARTESIANPOINT((5.1,-0.1));
#113=IFCCARTESIANPOINT((5.1,0.1));
#200=IFCDOOR('door-guid-200',$,'Door1',$,$,#201,#202,$,2.1,0.9);
#201=IFCLOCALPLACEMENT(#11,#203);
#202=IFCSHAPEREPRESENTATION(#1,'Body','BoundingBox',(#204));
#203=IFCAXIS2PLACEMENT3D(#205,$,$);
#204=IFCBOUNDINGBOX(#206,0.9,0.2,2.1);
#205=IFCCARTESIANPOINT((2.,0.,0.));
#206=IFCAXIS2PLACEMENT3D(#207,$,$);
#207=IFCCARTESIANPOINT((0.,0.,0.));
#300=IFCWINDOW('win-guid-300',$,'Win1',$,$,#301,#302,$,1.2,1.0);
#301=IFCLOCALPLACEMENT(#11,#303);
#302=IFCSHAPEREPRESENTATION(#1,'Body','BoundingBox',(#304));
#303=IFCAXIS2PLACEMENT3D(#305,$,$);
#304=IFCBOUNDINGBOX(#306,1.0,0.15,1.2);
#305=IFCCARTESIANPOINT((3.,0.,0.9));
#306=IFCAXIS2PLACEMENT3D(#307,$,$);
#307=IFCCARTESIANPOINT((0.,0.,0.));
#400=IFCSPACE('room-guid-400',$,'Room1',$,$,#401,#402,$,$,.ELEMENT.,.INTERNAL.);
#401=IFCLOCALPLACEMENT(#11,#403);
#402=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#410));
#403=IFCAXIS2PLACEMENT3D(#404,$,$);
#404=IFCCARTESIANPOINT((0.,0.,0.));
#410=IFCEXTRUDEDAREASOLID(#411,#412,#413,3.0);
#411=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#414);
#412=IFCAXIS2PLACEMENT3D(#415,$,$);
#413=IFCDIRECTION((0.,0.,1.));
#414=IFCPOLYLINE((#416,#417,#418,#419,#416));
#415=IFCCARTESIANPOINT((0.,0.,0.));
#416=IFCCARTESIANPOINT((0.,0.));
#417=IFCCARTESIANPOINT((5.,0.));
#418=IFCCARTESIANPOINT((5.,4.));
#419=IFCCARTESIANPOINT((0.,4.));
#500=IFCSLAB('slab-guid-500',$,'Slab1',$,$,#501,#502,$,.FLOOR.);
#501=IFCLOCALPLACEMENT(#11,#503);
#502=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#510));
#503=IFCAXIS2PLACEMENT3D(#504,$,$);
#504=IFCCARTESIANPOINT((0.,0.,0.));
#510=IFCEXTRUDEDAREASOLID(#511,#512,#513,0.2);
#511=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#514);
#512=IFCAXIS2PLACEMENT3D(#515,$,$);
#513=IFCDIRECTION((0.,0.,1.));
#514=IFCPOLYLINE((#516,#517,#518,#519,#516));
#515=IFCCARTESIANPOINT((0.,0.,0.));
#516=IFCCARTESIANPOINT((0.,0.));
#517=IFCCARTESIANPOINT((5.,0.));
#518=IFCCARTESIANPOINT((5.,4.));
#519=IFCCARTESIANPOINT((0.,4.));
#600=IFCCOLUMN('col-guid-600',$,'Column1',$,$,#601,#602,$,$);
#601=IFCLOCALPLACEMENT(#11,#603);
#602=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#610));
#603=IFCAXIS2PLACEMENT3D(#604,$,$);
#604=IFCCARTESIANPOINT((3.,3.,0.));
#610=IFCEXTRUDEDAREASOLID(#611,#612,#613,3.0);
#611=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#614);
#612=IFCAXIS2PLACEMENT3D(#615,$,$);
#613=IFCDIRECTION((0.,0.,1.));
#614=IFCPOLYLINE((#616,#617,#618,#619,#616));
#615=IFCCARTESIANPOINT((0.,0.,0.));
#616=IFCCARTESIANPOINT((0.,0.));
#617=IFCCARTESIANPOINT((0.3,0.));
#618=IFCCARTESIANPOINT((0.3,0.3));
#619=IFCCARTESIANPOINT((0.,0.3));
ENDSEC;
END-ISO-10303-21;`;

// ── Known IDs used in assertions ──────────────────────────────────────────────
const STOREY_APP_ID = 'sty_10';
const WALL_APP_ID   = 'w_100';
const DOOR_APP_ID   = 'dr_200';
const WIN_APP_ID    = 'wn_300';
const ROOM_APP_ID   = 'rm_400';
const SLAB_APP_ID   = 'slab_500';
const COL_APP_ID    = 'gen_600';

// ── Base ItemsMap (mirrors every entity in the fixture) ───────────────────────
function baseItems(): ItemsMap {
  return {
    [STOREY_APP_ID]: {
      id: STOREY_APP_ID, GlobalId: 'storey-guid-001', type: 'Storey',
      ifcType: 'IfcBuildingStorey', name: 'GF', Name: 'GF', parentId: 'bld_9',
      geom: { level: 0, elevation: 0, thickness: 3 }, grossArea: 0,
    },
    [WALL_APP_ID]: {
      id: WALL_APP_ID, GlobalId: 'wall-guid-100', type: 'Wall', ifcType: 'IfcWall',
      name: 'Wall1', Name: 'Wall1', parentId: STOREY_APP_ID,
      geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 3 },
    },
    [DOOR_APP_ID]: {
      id: DOOR_APP_ID, GlobalId: 'door-guid-200', type: 'Door', ifcType: 'IfcDoor',
      name: 'Door1', Name: 'Door1', parentId: STOREY_APP_ID,
      geom: { wallId: WALL_APP_ID, t: 0.4, width: 0.9, height: 2.1, swing: 'left', side: 0 },
      OperationType: 'SINGLE_SWING_LEFT',
    },
    [WIN_APP_ID]: {
      id: WIN_APP_ID, GlobalId: 'win-guid-300', type: 'Window', ifcType: 'IfcWindow',
      name: 'Win1', Name: 'Win1', parentId: STOREY_APP_ID,
      geom: { wallId: WALL_APP_ID, t: 0.7, width: 1.0, height: 1.2, sillHeight: 0.9 },
    },
    [ROOM_APP_ID]: {
      id: ROOM_APP_ID, GlobalId: 'room-guid-400', type: 'Room', ifcType: 'IfcSpace',
      name: 'Room1', Name: 'Room1', parentId: STOREY_APP_ID,
      geom: { polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][], height: 3 },
      function: 'NOTDEFINED', occupancy: 0,
    },
    [SLAB_APP_ID]: {
      id: SLAB_APP_ID, GlobalId: 'slab-guid-500', type: 'Slab', ifcType: 'IfcSlab',
      name: 'Slab1', Name: 'Slab1', parentId: STOREY_APP_ID,
      geom: { polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][], thickness: 0.2 },
    },
    [COL_APP_ID]: {
      id: COL_APP_ID, GlobalId: 'col-guid-600', type: 'GenericElement', ifcType: 'IfcColumn',
      name: 'Column1', Name: 'Column1', parentId: STOREY_APP_ID,
      expressID: 600, isGenericIfcElement: true, category: 'IfcColumn',
      geom: { x: 3, y: 3, w: 0.3, d: 0.3, h: 3, rotation: 0 },
    },
  } as unknown as ItemsMap;
}

// All fixture elements except the wall (used in preservation cross-checks)
const ALL_FIXTURE_ELEMENT_IDS = [100, 200, 300, 400, 500, 600] as const;

function assertOthersPreserved(
  step: Map<number, StepEntity>,
  deletedId: number,
) {
  for (const id of ALL_FIXTURE_ELEMENT_IDS) {
    if (id === deletedId) continue;
    const ent = step.get(id);
    expect(ent, `entity #${id} must exist`).toBeDefined();
    expect(hasGeom(ent!), `entity #${id} must still have geometry`).toBe(true);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('patchIFC round-trip', () => {

  // ── Wall (mur) ──────────────────────────────────────────────────────────────
  describe('Wall / Mur', () => {

    it('create: injects a new IFCWALL with non-null geometry', async () => {
      const items = baseItems();
      items['w_new'] = {
        id: 'w_new', GlobalId: 'new-wall-guid-test', type: 'Wall', ifcType: 'IfcWall',
        name: 'NewWall', Name: 'NewWall', parentId: STOREY_APP_ID,
        geom: { x1: 0, y1: 5, x2: 8, y2: 5, thickness: 0.2, height: 3 },
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const walls = entitiesOfType(step, 'IFCWALL');
      const newWall = walls.find(([, e]) => e.args[0] === "'new-wall-guid-test'");
      expect(newWall, 'new IFCWALL entity must appear').toBeDefined();
      expect(hasGeom(newWall![1]), 'new wall must have placement and shape').toBe(true);
    });

    it('create: emits IFCRELCONTAINEDINSPATIALSTRUCTURE referencing storey #10', async () => {
      const items = baseItems();
      items['w_new'] = {
        id: 'w_new', GlobalId: 'new-wall-guid-test', type: 'Wall', ifcType: 'IfcWall',
        name: 'NewWall', Name: 'NewWall', parentId: STOREY_APP_ID,
        geom: { x1: 0, y1: 5, x2: 8, y2: 5, thickness: 0.2, height: 3 },
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const rels = entitiesOfType(step, 'IFCRELCONTAINEDINSPATIALSTRUCTURE');
      const relToStorey = rels.find(([, e]) => e.args[e.args.length - 1] === '#10');
      expect(relToStorey, 'relationship to storey must exist').toBeDefined();
    });

    it('update: updates placement for existing IFCWALL, preserves original representation', async () => {
      const items = baseItems();
      (items[WALL_APP_ID] as any).geom.x2 = 8;
      (items[WALL_APP_ID] as any).geom._edited = true;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const wall = parseStep(out).get(100)!;
      expect(wall).toBeDefined();
      expect(wall.args[5]).not.toBe('#102');
      expect(hasGeom(wall)).toBe(true);
    });

    it('update: GlobalId is unchanged after geometry patch', async () => {
      const items = baseItems();
      (items[WALL_APP_ID] as any).geom.height = 4;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      expect(step.get(100)!.args[0]).toBe("'wall-guid-100'");
    });

    it('delete: nulls IFCWALL representation', async () => {
      const items = baseItems();
      delete items[WALL_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      expect(isNulled(step.get(100)!), 'wall representation must be nulled').toBe(true);
    });

    it('delete: preserves all other elements', async () => {
      const items = baseItems();
      delete items[WALL_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      assertOthersPreserved(parseStep(out), 100);
    });
  });

  // ── Door (porte) ────────────────────────────────────────────────────────────
  describe('Door / Porte', () => {

    it('create: injects a new IFCDOOR with non-null geometry', async () => {
      const items = baseItems();
      items['dr_new'] = {
        id: 'dr_new', GlobalId: 'new-door-guid-test', type: 'Door', ifcType: 'IfcDoor',
        name: 'NewDoor', Name: 'NewDoor', parentId: STOREY_APP_ID,
        geom: { wallId: WALL_APP_ID, t: 0.2, width: 1.0, height: 2.1, swing: 'right', side: 0 },
        OperationType: 'SINGLE_SWING_RIGHT',
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const doors = entitiesOfType(step, 'IFCDOOR');
      const newDoor = doors.find(([, e]) => e.args[0] === "'new-door-guid-test'");
      expect(newDoor, 'new IFCDOOR must appear').toBeDefined();
      expect(hasGeom(newDoor![1])).toBe(true);
    });

    it('update: updates placement for existing IFCDOOR, preserves original representation', async () => {
      const items = baseItems();
      (items[DOOR_APP_ID] as any).geom.t = 0.6;
      (items[DOOR_APP_ID] as any).geom.width = 1.2;
      (items[DOOR_APP_ID] as any).geom._edited = true;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const door = parseStep(out).get(200)!;
      expect(door.args[5]).not.toBe('#202');
      expect(hasGeom(door)).toBe(true);
    });

    it('update: GlobalId is unchanged after geometry patch', async () => {
      const items = baseItems();
      (items[DOOR_APP_ID] as any).geom.t = 0.5;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(parseStep(out).get(200)!.args[0]).toBe("'door-guid-200'");
    });

    it('delete: nulls IFCDOOR representation', async () => {
      const items = baseItems();
      delete items[DOOR_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(isNulled(parseStep(out).get(200)!)).toBe(true);
    });

    it('delete: preserves all other elements', async () => {
      const items = baseItems();
      delete items[DOOR_APP_ID];

      assertOthersPreserved(parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))), 200);
    });
  });

  // ── Window (fenêtre) ────────────────────────────────────────────────────────
  describe('Window / Fenêtre', () => {

    it('create: injects a new IFCWINDOW with non-null geometry', async () => {
      const items = baseItems();
      items['wn_new'] = {
        id: 'wn_new', GlobalId: 'new-win-guid-test', type: 'Window', ifcType: 'IfcWindow',
        name: 'NewWin', Name: 'NewWin', parentId: STOREY_APP_ID,
        geom: { wallId: WALL_APP_ID, t: 0.3, width: 1.2, height: 1.5, sillHeight: 1.0 },
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const wins = entitiesOfType(step, 'IFCWINDOW');
      const newWin = wins.find(([, e]) => e.args[0] === "'new-win-guid-test'");
      expect(newWin, 'new IFCWINDOW must appear').toBeDefined();
      expect(hasGeom(newWin![1])).toBe(true);
    });

    it('create export: writes partitioning for double-panel windows without an original buffer', () => {
      const items = baseItems();
      (items[WIN_APP_ID] as any).OperationType = 'DOUBLE_PANEL_VERTICAL';

      const win = [...parseStep(exportIFC(items)).values()].find((e) => e.type === 'IFCWINDOW' && e.args[0] === "'win-guid-300'")!;
      expect(win.args[10]).toBe('.WINDOW.');
      expect(win.args[11]).toBe('.DOUBLE_PANEL_VERTICAL.');
    });

    it('update: preserves exported partitioning for existing double-panel windows', async () => {
      const items = baseItems();
      (items[WIN_APP_ID] as any).OperationType = 'DOUBLE_PANEL_VERTICAL';

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const win = parseStep(out).get(300)!;
      expect(win.args[10]).toBe('.WINDOW.');
      expect(win.args[11]).toBe('.DOUBLE_PANEL_VERTICAL.');
    });

    it('update: updates placement for existing IFCWINDOW, preserves original representation', async () => {
      const items = baseItems();
      (items[WIN_APP_ID] as any).geom.sillHeight = 1.2;
      (items[WIN_APP_ID] as any).geom.height = 0.8;
      (items[WIN_APP_ID] as any).geom._edited = true;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const win = parseStep(out).get(300)!;
      expect(win.args[5]).not.toBe('#302');
      expect(hasGeom(win)).toBe(true);
    });

    it('update: GlobalId is unchanged after geometry patch', async () => {
      const items = baseItems();
      (items[WIN_APP_ID] as any).geom.width = 0.8;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(parseStep(out).get(300)!.args[0]).toBe("'win-guid-300'");
    });

    it('delete: nulls IFCWINDOW representation', async () => {
      const items = baseItems();
      delete items[WIN_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(isNulled(parseStep(out).get(300)!)).toBe(true);
    });

    it('delete: preserves all other elements', async () => {
      const items = baseItems();
      delete items[WIN_APP_ID];

      assertOthersPreserved(parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))), 300);
    });

    it('update: moving one window keeps sibling windows paired with regenerated openings', async () => {
      const ifc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('SkAItch unit test'),'2;1');
FILE_NAME('multi-window.ifc','2024-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-5,#2,$);
#2=IFCAXIS2PLACEMENT3D(#3,$,$);
#3=IFCCARTESIANPOINT((0.,0.,0.));
#10=IFCBUILDINGSTOREY('storey-guid-001',$,'GF',$,$,#11,$,$,.NOTDEFINED.,0.);
#11=IFCLOCALPLACEMENT($,#12);
#12=IFCAXIS2PLACEMENT3D(#13,$,$);
#13=IFCCARTESIANPOINT((0.,0.,0.));
#100=IFCWALL('wall-guid-100',$,'Wall1',$,$,#101,#102,$,$);
#101=IFCLOCALPLACEMENT(#11,#103);
#102=IFCSHAPEREPRESENTATION(#1,'Body','SweptSolid',(#104));
#103=IFCAXIS2PLACEMENT3D(#105,$,$);
#104=IFCEXTRUDEDAREASOLID(#106,#107,#108,3.0);
#105=IFCCARTESIANPOINT((0.,0.,0.));
#106=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#109);
#107=IFCAXIS2PLACEMENT3D(#110,$,$);
#108=IFCDIRECTION((0.,0.,1.));
#109=IFCPOLYLINE((#111,#112,#113,#111));
#110=IFCCARTESIANPOINT((0.,0.,0.));
#111=IFCCARTESIANPOINT((-0.1,-0.1));
#112=IFCCARTESIANPOINT((5.1,-0.1));
#113=IFCCARTESIANPOINT((5.1,0.1));
#300=IFCWINDOW('win-guid-a',$,'WinA',$,$,#301,#302,$,1.2,1.0);
#301=IFCLOCALPLACEMENT(#701,#303);
#302=IFCSHAPEREPRESENTATION(#1,'Body','BoundingBox',(#304));
#303=IFCAXIS2PLACEMENT3D(#305,$,$);
#304=IFCBOUNDINGBOX(#306,1.0,0.15,1.2);
#305=IFCCARTESIANPOINT((0.,0.,0.05));
#306=IFCAXIS2PLACEMENT3D(#307,$,$);
#307=IFCCARTESIANPOINT((0.,0.,0.));
#310=IFCWINDOW('win-guid-b',$,'WinB',$,$,#311,#312,$,1.2,1.0);
#311=IFCLOCALPLACEMENT(#711,#313);
#312=IFCSHAPEREPRESENTATION(#1,'Body','BoundingBox',(#314));
#313=IFCAXIS2PLACEMENT3D(#315,$,$);
#314=IFCBOUNDINGBOX(#316,1.0,0.15,1.2);
#315=IFCCARTESIANPOINT((0.,0.,0.05));
#316=IFCAXIS2PLACEMENT3D(#317,$,$);
#317=IFCCARTESIANPOINT((0.,0.,0.));
#700=IFCOPENINGELEMENT('opening-a',$,'OpeningA',$,$,#701,$,$,.OPENING.);
#701=IFCLOCALPLACEMENT(#101,#703);
#703=IFCAXIS2PLACEMENT3D(#705,$,$);
#705=IFCCARTESIANPOINT((1.,0.,0.85));
#710=IFCOPENINGELEMENT('opening-b',$,'OpeningB',$,$,#711,$,$,.OPENING.);
#711=IFCLOCALPLACEMENT(#101,#713);
#713=IFCAXIS2PLACEMENT3D(#715,$,$);
#715=IFCCARTESIANPOINT((4.,0.,0.85));
#900=IFCRELFILLSELEMENT('fill-a',$,$,$,#700,#300);
#901=IFCRELFILLSELEMENT('fill-b',$,$,$,#710,#310);
#910=IFCRELVOIDSELEMENT('void-a',$,$,$,#100,#700);
#911=IFCRELVOIDSELEMENT('void-b',$,$,$,#100,#710);
ENDSEC;
END-ISO-10303-21;`;
      const items: ItemsMap = {
        [STOREY_APP_ID]: baseItems()[STOREY_APP_ID],
        [WALL_APP_ID]: baseItems()[WALL_APP_ID],
        wn_300: {
          id: 'wn_300', GlobalId: 'win-guid-a', type: 'Window', ifcType: 'IfcWindow',
          name: 'WinA', Name: 'WinA', parentId: STOREY_APP_ID,
          geom: { wallId: WALL_APP_ID, t: 0.5, width: 1, height: 1.2, sillHeight: 0.9, openingExpId: 700, _edited: true },
        },
        wn_310: {
          id: 'wn_310', GlobalId: 'win-guid-b', type: 'Window', ifcType: 'IfcWindow',
          name: 'WinB', Name: 'WinB', parentId: STOREY_APP_ID,
          geom: { wallId: WALL_APP_ID, t: 0.8, width: 1, height: 1.2, sillHeight: 0.9, openingExpId: 710 },
        },
      } as unknown as ItemsMap;

      const step = parseStep(await patchIFC(items, toBuffer(ifc)));

      // Body-less openings are read back from their origin as the centre (t * wall length).
      expect(cartesianPointTuple(step, 705)[0]).toBeCloseTo(2.5, 6);
      expect(cartesianPointTuple(step, 715)[0]).toBeCloseTo(4.0, 6);
      expect(step.get(310)!.args[5]).toBe('#311');
      expect(step.get(710)!.args[5]).toBe('#711');
    });
  });

  // ── Room / Pièce (IFCSPACE) ─────────────────────────────────────────────────
  describe('Room / Pièce', () => {

    it('create: injects a new IFCSPACE without viewer geometry', async () => {
      const items = baseItems();
      items['rm_new'] = {
        id: 'rm_new', GlobalId: 'new-room-guid-test', type: 'Room', ifcType: 'IfcSpace',
        name: 'NewRoom', Name: 'NewRoom', parentId: STOREY_APP_ID,
        geom: {
          polygon: [[0, 5], [4, 5], [4, 9], [0, 9]] as [number, number][],
          height: 2.8,
        },
        function: 'NOTDEFINED', occupancy: 2,
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const spaces = entitiesOfType(step, 'IFCSPACE');
      const newRoom = spaces.find(([, e]) => e.args[0] === "'new-room-guid-test'");
      expect(newRoom, 'new IFCSPACE entity must appear').toBeDefined();
      expect(newRoom![1].args[5]).toBe('$');
      expect(newRoom![1].args[6]).toBe('$');
    });

    it('create: emits IFCRELAGGREGATES linking room to storey', async () => {
      const items = baseItems();
      items['rm_new'] = {
        id: 'rm_new', GlobalId: 'new-room-guid-test', type: 'Room', ifcType: 'IfcSpace',
        name: 'NewRoom', Name: 'NewRoom', parentId: STOREY_APP_ID,
        geom: { polygon: [[0, 5], [4, 5], [4, 9], [0, 9]] as [number, number][], height: 2.8 },
        function: 'NOTDEFINED', occupancy: 0,
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const aggs = entitiesOfType(step, 'IFCRELAGGREGATES');
      const aggToStorey = aggs.find(([, e]) => e.args[4] === '#10');
      expect(aggToStorey, 'IFCRELAGGREGATES to storey must exist').toBeDefined();
    });

    it('update: removes geometry for edited IFCSPACE so the viewer cannot draw a box', async () => {
      const items = baseItems();
      (items[ROOM_APP_ID] as any).geom.polygon = [[0, 0], [6, 0], [6, 5], [0, 5]];
      (items[ROOM_APP_ID] as any).geom._edited = true;

      const room = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))).get(400)!;
      expect(room.args[5]).toBe('$');
      expect(room.args[6]).toBe('$');
    });

    it('update: translating an imported IFCSPACE keeps its body and moves its placement', async () => {
      const items = baseItems();
      (items[ROOM_APP_ID] as any).geom = {
        ...(items[ROOM_APP_ID] as any).geom,
        polygon: [[2, 1], [7, 1], [7, 5], [2, 5]],
        _placementWorld: [2, 1],
        _edited: true,
      };

      const room = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))).get(400)!;
      expect(room.args[5]).not.toBe('$');
      expect(room.args[6]).toBe('#402');
    });

    it('update: reshaping an imported IFCSPACE removes its stale geometry', async () => {
      const items = baseItems();
      (items[ROOM_APP_ID] as any).geom = {
        ...(items[ROOM_APP_ID] as any).geom,
        polygon: [[0, 0], [7, 0], [7, 4], [0, 4]],
        _placementWorld: [0, 0],
        _edited: true,
        _shapeEdited: true,
      };

      const room = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))).get(400)!;
      expect(room.args[5]).toBe('$');
      expect(room.args[6]).toBe('$');
    });

    it('update: GlobalId is unchanged after geometry patch', async () => {
      const items = baseItems();
      (items[ROOM_APP_ID] as any).geom.height = 2.5;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(parseStep(out).get(400)!.args[0]).toBe("'room-guid-400'");
    });

    it('delete: nulls IFCSPACE representation', async () => {
      const items = baseItems();
      delete items[ROOM_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(isNulled(parseStep(out).get(400)!)).toBe(true);
    });

    it('delete: preserves all other elements', async () => {
      const items = baseItems();
      delete items[ROOM_APP_ID];

      assertOthersPreserved(parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))), 400);
    });
  });

  // ── Slab / Dalle (IFCSLAB) ──────────────────────────────────────────────────
  describe('Slab / Dalle', () => {

    it('create: injects a new IFCSLAB with non-null geometry', async () => {
      const items = baseItems();
      items['slab_new'] = {
        id: 'slab_new', GlobalId: 'new-slab-guid-test', type: 'Slab', ifcType: 'IfcSlab',
        name: 'NewSlab', Name: 'NewSlab', parentId: STOREY_APP_ID,
        geom: {
          polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] as [number, number][],
          thickness: 0.3,
        },
      } as unknown as ItemsMap[string];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const step = parseStep(out);

      const slabs = entitiesOfType(step, 'IFCSLAB');
      const newSlab = slabs.find(([, e]) => e.args[0] === "'new-slab-guid-test'");
      expect(newSlab, 'new IFCSLAB must appear').toBeDefined();
      expect(hasGeom(newSlab![1])).toBe(true);
    });

    it('update: updates placement for existing IFCSLAB, preserves original representation', async () => {
      const items = baseItems();
      (items[SLAB_APP_ID] as any).geom.thickness = 0.35;
      (items[SLAB_APP_ID] as any).geom.polygon = [[0, 0], [6, 0], [6, 5], [0, 5]];
      (items[SLAB_APP_ID] as any).geom._edited = true;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      const slab = parseStep(out).get(500)!;
      expect(slab.args[5]).not.toBe('#502');
      expect(hasGeom(slab)).toBe(true);
    });

    it('update: GlobalId is unchanged after geometry patch', async () => {
      const items = baseItems();
      (items[SLAB_APP_ID] as any).geom.thickness = 0.25;

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(parseStep(out).get(500)!.args[0]).toBe("'slab-guid-500'");
    });

    it('delete: nulls IFCSLAB representation', async () => {
      const items = baseItems();
      delete items[SLAB_APP_ID];

      const out = await patchIFC(items, toBuffer(FIXTURE_IFC));
      expect(isNulled(parseStep(out).get(500)!)).toBe(true);
    });

    it('delete: preserves all other elements', async () => {
      const items = baseItems();
      delete items[SLAB_APP_ID];

      assertOthersPreserved(parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC))), 500);
    });
  });

  // ── Generic IFC elements ────────────────────────────────────────────────────
  describe('Generic IFC element', () => {

    it('update: translating an imported generic element preserves original representation', async () => {
      const items = baseItems();
      (items[COL_APP_ID] as any).geom = {
        ...(items[COL_APP_ID] as any).geom,
        x: 4,
        y: 3,
        _placementWorld: [4, 3],
        _edited: true,
      };

      const step = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC)));
      const col = step.get(600)!;

      expect(isNewPlacement(col, '#602')).toBe(true);
      expect(entitiesOfType(step, 'IFCSHAPEREPRESENTATION').every(([id]) => id <= FIXTURE_MAX_ID)).toBe(true);
    });
  });

  // ── Cross-element preservation ───────────────────────────────────────────────
  describe('Preservation — multi-delete', () => {

    it('deleting wall + door leaves window, room, slab, column intact', async () => {
      const items = baseItems();
      delete items[WALL_APP_ID];
      delete items[DOOR_APP_ID];

      const step = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC)));
      expect(isNulled(step.get(100)!)).toBe(true);
      expect(isNulled(step.get(200)!)).toBe(true);
      expect(hasGeom(step.get(300)!)).toBe(true);
      expect(hasGeom(step.get(400)!)).toBe(true);
      expect(hasGeom(step.get(500)!)).toBe(true);
      expect(hasGeom(step.get(600)!)).toBe(true);
    });

    it('no-op: all items present → no entity is nulled', async () => {
      const step = parseStep(await patchIFC(baseItems(), toBuffer(FIXTURE_IFC)));

      for (const id of ALL_FIXTURE_ELEMENT_IDS) {
        expect(isNulled(step.get(id)!), `entity #${id} must not be nulled`).toBe(false);
      }
    });

    it('output still contains valid ENDSEC marker', async () => {
      const out = await patchIFC(baseItems(), toBuffer(FIXTURE_IFC));
      expect(out).toContain('ENDSEC;');
    });
  });
});

// ── Real IFC file tests ───────────────────────────────────────────────────────
// Regression: "moved a door, external viewer showed only walls"
// Requires ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc (IFC4, Revit export)
//
// Entity map (from static analysis of the file):
//   Storey:  #43880  GlobalId='1o0c33arXF9AEePDYchjCY'
//   Walls:   #1      GlobalId='3cUkl32yn9qRSPvBJVyWw5'
//            #371    GlobalId='3cUkl32yn9qRSPvBJVyWx4'
//            #542    GlobalId='3cUkl32yn9qRSPvBJVyWy4'
//   Doors:   #915    GlobalId='3cUkl32yn9qRSPvBJVyWYp'
//            #4370   GlobalId='3cUkl32yn9qRSPvBJVyWaG'
//            #10481  GlobalId='3cUkl32yn9qRSPvBJVyWax'
//   Windows: #16584  GlobalId='3cUkl32yn9qRSPvBJVyWcE'
//            #16955  GlobalId='3cUkl32yn9qRSPvBJVyWdx'
//            #16964  GlobalId='3cUkl32yn9qRSPvBJVyWe9'
//            #17039  GlobalId='3cUkl32yn9qRSPvBJVyZTO'
//   Slab:    #17022  GlobalId='3cUkl32yn9qRSPvBJVyWgQ'
//   Spaces:  #43881  GlobalId='3w0zWKm7n8SB1qbfwUzt0U'
//            #43896  GlobalId='3w0zWKm7n8SB1qbfwUzt0J'

const REAL_IFC_PATH = path.resolve(__dirname, '../../../ifc_test_files/Ifc4_SampleHouse_0_GroundFloor.ifc');

const REAL_STOREY_APP_ID = 'sty_43880';
const REAL_WALL_IDS   = [1, 371, 542]   as const;
const REAL_DOOR_IDS   = [915, 4370, 10481] as const;
const REAL_WIN_IDS    = [16584, 16955, 16964, 17039] as const;
const REAL_SLAB_IDS   = [17022] as const;
const REAL_SPACE_IDS  = [43881, 43896] as const;
const REAL_ALL_IDS    = [...REAL_WALL_IDS, ...REAL_DOOR_IDS, ...REAL_WIN_IDS, ...REAL_SLAB_IDS, ...REAL_SPACE_IDS];

const REAL_WALL_GUIDS   = ['3cUkl32yn9qRSPvBJVyWw5', '3cUkl32yn9qRSPvBJVyWx4', '3cUkl32yn9qRSPvBJVyWy4'];
const REAL_DOOR_GUIDS   = ['3cUkl32yn9qRSPvBJVyWYp', '3cUkl32yn9qRSPvBJVyWaG', '3cUkl32yn9qRSPvBJVyWax'];
const REAL_WIN_GUIDS    = ['3cUkl32yn9qRSPvBJVyWcE', '3cUkl32yn9qRSPvBJVyWdx', '3cUkl32yn9qRSPvBJVyWe9', '3cUkl32yn9qRSPvBJVyZTO'];
const REAL_SLAB_GUIDS   = ['3cUkl32yn9qRSPvBJVyWgQ'];
const REAL_SPACE_GUIDS  = ['3w0zWKm7n8SB1qbfwUzt0U', '3w0zWKm7n8SB1qbfwUzt0J'];

function realFileItems(): ItemsMap {
  const items: Record<string, unknown> = {};

  items[REAL_STOREY_APP_ID] = {
    id: REAL_STOREY_APP_ID, GlobalId: '1o0c33arXF9AEePDYchjCY', type: 'Storey',
    ifcType: 'IfcBuildingStorey', name: 'Ground Floor', Name: 'Ground Floor',
    parentId: 'bld_x', geom: { level: 0, elevation: 0, thickness: 3 }, grossArea: 0,
  };

  REAL_WALL_IDS.forEach((expId, i) => {
    const id = `w_${expId}`;
    items[id] = {
      id, GlobalId: REAL_WALL_GUIDS[i], type: 'Wall', ifcType: 'IfcWall',
      name: 'Wall', Name: 'Wall', parentId: REAL_STOREY_APP_ID,
      geom: { x1: 0, y1: 0, x2: 5, y2: 0, thickness: 0.2, height: 3 },
    };
  });

  REAL_DOOR_IDS.forEach((expId, i) => {
    const id = `dr_${expId}`;
    items[id] = {
      id, GlobalId: REAL_DOOR_GUIDS[i], type: 'Door', ifcType: 'IfcDoor',
      name: 'Door', Name: 'Door', parentId: REAL_STOREY_APP_ID,
      geom: { wallId: '', t: 0.5, width: 0.9, height: 2.1, swing: 'left', side: 0 },
    };
  });

  REAL_WIN_IDS.forEach((expId, i) => {
    const id = `wn_${expId}`;
    items[id] = {
      id, GlobalId: REAL_WIN_GUIDS[i], type: 'Window', ifcType: 'IfcWindow',
      name: 'Window', Name: 'Window', parentId: REAL_STOREY_APP_ID,
      geom: { wallId: '', t: 0.5, width: 1.0, height: 1.2, sillHeight: 0.9 },
    };
  });

  REAL_SLAB_IDS.forEach((expId, i) => {
    const id = `slab_${expId}`;
    items[id] = {
      id, GlobalId: REAL_SLAB_GUIDS[i], type: 'Slab', ifcType: 'IfcSlab',
      name: 'Slab', Name: 'Slab', parentId: REAL_STOREY_APP_ID,
      geom: { polygon: [[0, 0], [10, 0], [10, 8], [0, 8]] as [number, number][], thickness: 0.2 },
    };
  });

  REAL_SPACE_IDS.forEach((expId, i) => {
    const id = `rm_${expId}`;
    items[id] = {
      id, GlobalId: REAL_SPACE_GUIDS[i], type: 'Room', ifcType: 'IfcSpace',
      name: 'Room', Name: 'Room', parentId: REAL_STOREY_APP_ID,
      geom: { polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][], height: 3 },
      function: 'NOTDEFINED', occupancy: 0,
    };
  });

  return items as unknown as ItemsMap;
}

describe('patchIFC — real IFC file (Ifc4_SampleHouse_0_GroundFloor.ifc)', () => {
  let ifcText: string;

  try {
    ifcText = fs.readFileSync(REAL_IFC_PATH, 'utf-8');
  } catch {
    ifcText = '';
  }

  const skip = !ifcText;

  it('file is present and non-empty', () => {
    expect(ifcText.length, 'IFC test file must exist and be non-empty').toBeGreaterThan(0);
  });

  it('no-op: all managed entities present → none are nulled', async () => {
    if (skip) return;
    const step = parseStep(await patchIFC(realFileItems(), toBuffer(ifcText)));
    for (const id of REAL_ALL_IDS) {
      const ent = step.get(id);
      expect(ent, `entity #${id} must exist`).toBeDefined();
      expect(isNulled(ent!), `entity #${id} must not be nulled after no-op patch`).toBe(false);
    }
  });

  it('move door: only the moved door is re-patched, all other entities preserved', async () => {
    if (skip) return;
    const items = realFileItems();
    // Simulate moving door #4370 along its wall
    (items['dr_4370'] as any).geom.t = 0.3;

    const step = parseStep(await patchIFC(items, toBuffer(ifcText)));

    // Moved door must not be nulled
    const movedDoor = step.get(4370);
    expect(movedDoor, 'moved door #4370 must still exist').toBeDefined();
    expect(isNulled(movedDoor!), 'moved door must not be nulled').toBe(false);

    // All other managed entities must be intact — regression for "only walls visible"
    for (const id of REAL_ALL_IDS.filter(id => id !== 4370)) {
      const ent = step.get(id);
      expect(ent, `entity #${id} must exist`).toBeDefined();
      expect(isNulled(ent!), `entity #${id} must not be nulled`).toBe(false);
    }
  });

  it('delete door: only that door nulled, walls/windows/spaces/slab intact', async () => {
    if (skip) return;
    const items = realFileItems();
    delete items['dr_4370'];

    const step = parseStep(await patchIFC(items, toBuffer(ifcText)));

    expect(isNulled(step.get(4370)!), 'deleted door #4370 must be nulled').toBe(true);

    const preserved = REAL_ALL_IDS.filter(id => id !== 4370);
    for (const id of preserved) {
      const ent = step.get(id);
      expect(ent, `entity #${id} must exist`).toBeDefined();
      expect(isNulled(ent!), `entity #${id} must not be nulled`).toBe(false);
    }
  });

  it('output contains valid ENDSEC marker', async () => {
    if (skip) return;
    const out = await patchIFC(realFileItems(), toBuffer(ifcText));
    expect(out).toContain('ENDSEC;');
  });
});

it.each([['ROLLINGUP', '.ROLLINGUP.', '$'], ['SECTIONAL', '.USERDEFINED.', "'SECTIONAL'"], ['TILT_UP', '.USERDEFINED.', "'TILT_UP'"]])('exports garage operation %s without converting it to a swing door', async (operation, expected, custom) => {
  const items = baseItems();
  items.garage = { ...items[DOOR_APP_ID], id: 'garage', GlobalId: 'new-garage', OperationType: operation, geom: { ...(items[DOOR_APP_ID] as any).geom, width: 2.5 } } as any;
  const step = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC)));
  const door = entitiesOfType(step, 'IFCDOOR').find(([, e]) => e.args[0] === "'new-garage'")![1];
  expect(door.args[11]).toBe(expected);
  expect(door.args[12]).toBe(custom);
});

// ── Storey translation ────────────────────────────────────────────────────────
describe('translateStorey → patchIFC', () => {
  const DX = 2.5, DY = -1.25;
  const placementPoint = (step: Map<number, StepEntity>, expId: number): number[] => {
    const ref = (s: string) => parseInt(s.slice(1), 10);
    const plac = step.get(ref(step.get(expId)!.args[5]))!;
    expect(plac.type).toBe('IFCLOCALPLACEMENT');
    const axis = step.get(ref(plac.args[1]))!;
    return cartesianPointTuple(step, ref(axis.args[0]));
  };
  const imported = (): ItemsMap => {
    const items = baseItems();
    // The importer records each element's IFC placement origin.
    (items[ROOM_APP_ID] as any).geom._placementWorld = [0, 0];
    (items[SLAB_APP_ID] as any).geom._placementWorld = [0, 0];
    (items[COL_APP_ID] as any).geom._placementWorld = [3, 3];
    return items;
  };

  it('moves every placement by the offset and keeps original bodies, with no duplicates', async () => {
    const { translateStorey } = await import('@skaitch/ui/lib/translateStorey');
    const { items, warnings } = translateStorey(imported(), STOREY_APP_ID, DX, DY);
    expect(warnings).toEqual([]);
    const before = parseStep(FIXTURE_IFC);
    const step = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC)));

    for (const type of ['IFCWALL', 'IFCDOOR', 'IFCWINDOW', 'IFCSPACE', 'IFCSLAB', 'IFCCOLUMN', 'IFCBUILDINGSTOREY']) {
      expect(entitiesOfType(step, type).length, type).toBe(entitiesOfType(before, type).length);
    }
    for (const id of ALL_FIXTURE_ELEMENT_IDS) expect(hasGeom(step.get(id)!), `#${id} keeps geometry`).toBe(true);

    // Walls hosting doors/windows get a regenerated body with the openings cut at
    // their (unchanged) position along the wall; other bodies are kept verbatim.
    expect(step.get(400)!.args[6]).toBe('#402');
    expect(step.get(500)!.args[6]).toBe('#502');
    for (const id of [100, 400, 500]) {
      const [x, y] = placementPoint(step, id);
      expect(x, `#${id} x`).toBeCloseTo(DX, 6);
      expect(y, `#${id} y`).toBeCloseTo(DY, 6);
    }
    const [cx, cy] = placementPoint(step, 600);
    expect(cx).toBeCloseTo(3 + DX, 6);
    expect(cy).toBeCloseTo(3 + DY, 6);
    // The storey itself keeps its placement: only its contents move.
    expect(step.get(10)!.args[5]).toBe('#11');
    expect(cartesianPointTuple(step, 13)).toEqual([0, 0, 0]);
  });

  it('keeps doors and windows hosted at the same position along the moved wall', async () => {
    const { translateStorey } = await import('@skaitch/ui/lib/translateStorey');
    const { items } = translateStorey(imported(), STOREY_APP_ID, DX, DY);
    expect((items[DOOR_APP_ID] as any).geom.t).toBe(0.4);
    expect((items[WIN_APP_ID] as any).geom.wallId).toBe(WALL_APP_ID);
    const step = parseStep(await patchIFC(items, toBuffer(FIXTURE_IFC)));
    expect(entitiesOfType(step, 'IFCOPENINGELEMENT').length).toBe(entitiesOfType(parseStep(FIXTURE_IFC), 'IFCOPENINGELEMENT').length);
    for (const id of [200, 300]) expect(isNulled(step.get(id)!), `#${id}`).toBe(false);
  });

  it('a fresh export of the translated model is shifted by the same offset', async () => {
    const { translateStorey } = await import('@skaitch/ui/lib/translateStorey');
    const base = baseItems();
    const { items } = translateStorey(base, STOREY_APP_ID, DX, DY);
    const wallPoint = (text: string) => {
      const step = parseStep(text);
      const wall = entitiesOfType(step, 'IFCWALL').find(([, e]) => e.args[0] === "'wall-guid-100'")![0];
      return placementPoint(step, wall);
    };
    const [x0, y0] = wallPoint(exportIFC(base));
    const [x1, y1] = wallPoint(exportIFC(items));
    expect(x1 - x0).toBeCloseTo(DX, 6);
    expect(y1 - y0).toBeCloseTo(DY, 6);
  });
});
