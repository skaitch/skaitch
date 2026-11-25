import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { buildEmpty } from '@skaitch/core/data/starter';
import { applyAssociation } from '@skaitch/core/survey/association';
import { addRectangleRoom, connectRooms, deleteSurveyFurniture, moveRoom, newSurvey, setRoomFrozen, setSurveyFurniture } from '@skaitch/core/survey/edit';
import { reconstructStorey, surveyRefOf } from '@skaitch/core/survey/reconstruct';
import { furniturePlanFrame, readSurveyFile, writeSurveyFile, type SurveyFurniture } from '@skaitch/core/survey/surveyFile';
import SurveyPlan from '@skaitch/ui/components/survey/SurveyPlan';

const cabinet: SurveyFurniture = {
  id: 'cabinet', model: 'cuisine-meuble-bas', center: [1.2, 0.8],
  width_m: 0.9, depth_m: 0.45, height_m: 0.85, rotation: Math.PI / 4,
};

it('preserves surveyed furniture on import and updates the same BIM furniture on rebuild', () => {
  const empty = newSurvey('Appartement');
  const { survey, roomId } = addRectangleRoom(empty, empty.levels[0].id, 'Cuisine', 0, 0, 4, 3);
  const withFurniture = setSurveyFurniture(survey, roomId, cabinet);
  const restored = readSurveyFile(writeSurveyFile(withFurniture, 'test'));
  expect(restored.levels[0].rooms[0].furniture).toEqual([cabinet]);
  expect(renderToStaticMarkup(createElement(SurveyPlan, { level: restored.levels[0] }))).toContain('data-survey-furniture="cabinet"');

  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const attach = (model: typeof items, data: typeof survey) =>
    applyAssociation(model, data, storey.parentId!, [{ levelId: data.levels[0].id, target: storey.id }]).items;
  const first = reconstructStorey(attach(items, restored), storey.id);
  const piece = Object.values(first.items).find(i => i.type === 'Furniture')!;
  expect(piece).toMatchObject({
    model: cabinet.model, ifcType: 'IfcFurnishingElement', geom: { x: 0.75, w: 0.9, d: 0.45, h: 0.85, rotation: cabinet.rotation },
  });
  expect(piece.geom.y).toBeCloseTo(0.575);
  expect(surveyRefOf(piece)?.furnitureId).toBe(cabinet.id);
  expect(reconstructStorey(first.items, storey.id).created).toEqual([]);

  const moved = setSurveyFurniture(restored, roomId, { ...cabinet, center: [2, 1] });
  const second = reconstructStorey(attach(first.items, moved), storey.id);
  expect(second.updated).toContain(piece.id);
  expect(second.items[piece.id]).toMatchObject({ geom: { x: 1.55, y: 0.775 } });
  const manual = { ...second.items, [piece.id]: { ...piece, geom: { ...piece.geom, x: 2.5 }, surveyRef: surveyRefOf(second.items[piece.id]) } };
  const removed = deleteSurveyFurniture(moved, roomId, cabinet.id);
  expect(reconstructStorey(attach(second.items, removed), storey.id).deleted).toContain(piece.id);
  expect(reconstructStorey(attach(manual, removed), storey.id).conflicts).toContainEqual(expect.objectContaining({ id: piece.id, action: 'delete' }));
});

it('moves furniture with its room and keeps its two cotes when the room is turned to join another', () => {
  const empty = newSurvey('Appartement');
  const levelId = empty.levels[0].id;
  const reference = addRectangleRoom(empty, levelId, 'Salon', -6, 0, 4, 3);
  const { survey, roomId } = addRectangleRoom(reference.survey, levelId, 'Cuisine', 0, 0, 4, 3);
  const withFurniture = setSurveyFurniture(survey, roomId, cabinet);
  const room = moveRoom(withFurniture, roomId, 2, -1).levels[0].rooms[1];
  expect(room.furniture?.[0].center).toEqual([3.2, -0.2]);
  const [ref, moved] = withFurniture.levels[0].rooms;
  const joined = connectRooms(withFurniture, { roomId: ref.id, wallId: ref.walls[0].id },
    { roomId: moved.id, wallId: moved.walls[1].id }, 0, .2).levels[0].rooms[1];
  const furniture = joined.furniture![0];
  const cotes = furniturePlanFrame(joined).toPlan(furniture.center);
  expect(cotes[0]).toBeCloseTo(cabinet.center[0]);
  expect(cotes[1]).toBeCloseTo(cabinet.center[1]);
  expect(Math.sin(furniture.rotation - cabinet.rotation)).toBeCloseTo(1);
  expect(() => setSurveyFurniture(setRoomFrozen(withFurniture, roomId, true), roomId, cabinet)).toThrow();
  withFurniture.levels[0].rooms[1].furniture!.push({ ...cabinet, width_m: 0 });
  expect(() => writeSurveyFile(withFurniture, 'test')).toThrow(/meuble invalide/i);
});

it('rebuilds surveyed columns and chimneys as IfcColumn / IfcChimney, chimneys rising through the roof', () => {
  const empty = newSurvey('Maison');
  const { survey, roomId } = addRectangleRoom(empty, empty.levels[0].id, 'Séjour', 0, 0, 5, 4);
  const place = (s: typeof survey, id: string, model: string, center: [number, number], width = 0.4) =>
    setSurveyFurniture(s, roomId, { id, model, center, width_m: width, depth_m: width, height_m: 2.5, rotation: 0 });
  let withStructure = place(survey, 'p1', 'structure-column', [1, 1]);
  withStructure = place(withStructure, 'p2', 'structure-column-round', [3, 1], 0.3);
  withStructure = place(withStructure, 'c1', 'structure-fireplace', [2.5, 3], 1.2);
  const restored = readSurveyFile(writeSurveyFile(withStructure, 'test'));
  expect(restored.levels[0].rooms[0].furniture).toHaveLength(3);

  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  // A gable roof over the whole room, on the same storey.
  items.rf_test = { id: 'rf_test', type: 'Roof', ifcType: 'IfcRoof', name: 'Roof', Name: 'Roof', GlobalId: 'rf_test', parentId: storey.id,
    geom: { polygon: [[-1, -1], [6, -1], [6, 5], [-1, 5]], thickness: 0.25, elevation: 2.7, roofType: 'gable', pitch: 30, overhang: 0 } } as any;
  const { items: built } = reconstructStorey(applyAssociation(items, restored, storey.parentId!, [{ levelId: restored.levels[0].id, target: storey.id }]).items, storey.id);
  const columns = Object.values(built).filter(i => i.type === 'Column') as any[];
  expect(columns.map(c => [c.ifcType, c.geom.shape]).sort()).toEqual([['IfcColumn', 'circle'], ['IfcColumn', 'rect']]);
  const chimney = Object.values(built).find(i => i.type === 'Chimney') as any;
  expect(chimney).toMatchObject({ ifcType: 'IfcChimney', kind: 'fireplace', geom: { w: 1.2 } });
  expect(chimney.geom.h).toBeGreaterThan(2.7 + 0.5);
  expect(Object.values(built).some(i => i.type === 'Furniture')).toBe(false);
});

it('rebuilds a surveyed stove as a stove chimney', () => {
  const empty = newSurvey('Maison');
  const { survey, roomId } = addRectangleRoom(empty, empty.levels[0].id, 'Séjour', 0, 0, 5, 4);
  const withStove = setSurveyFurniture(survey, roomId, { id: 's1', model: 'structure-stove', center: [2, 2], width_m: 0.5, depth_m: 0.45, height_m: 2.5, rotation: 0 });
  const restored = readSurveyFile(writeSurveyFile(withStove, 'test'));
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const { items: built } = reconstructStorey(applyAssociation(items, restored, storey.parentId!, [{ levelId: restored.levels[0].id, target: storey.id }]).items, storey.id);
  expect(Object.values(built).find(i => i.type === 'Chimney')).toMatchObject({ kind: 'stove', geom: { hearthH: 0.9, flueW: 0.15 } });
});
