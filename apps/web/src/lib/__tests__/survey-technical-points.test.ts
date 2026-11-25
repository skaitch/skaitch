import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Canvas2D from '@skaitch/ui/components/canvas/Canvas2D';
import SurveyPlan from '@skaitch/ui/components/survey/SurveyPlan';
import { TECHNICAL_CATALOGUE as editorCatalogue } from '@skaitch/ui/data/technicalCatalogue';
import { renderTechnicalSymbol } from '@skaitch/ui/data/technicalSymbols';
import { buildEmpty } from '@skaitch/core/data/starter';
import { TECHNICAL_CATALOGUE } from '@skaitch/core/data/technicalCatalogue';
import { applyAssociation } from '@skaitch/core/survey/association';
import { surveyChecks } from '@skaitch/core/survey/checks';
import { addAdjacentRoom, addOpening, addRectangleRoom, deleteTechnicalPoint, newSurvey, setRoomFrozen, setTechnicalPoint, setWallLength } from '@skaitch/core/survey/edit';
import { reconstructStorey, surveyRefOf } from '@skaitch/core/survey/reconstruct';
import { readSurveyFile, technicalPointPlanPosition, writeSurveyFile, type SurveyTechnicalPoint } from '@skaitch/core/survey/surveyFile';

it('round-trips a wall elevation and reconstructs measured centres from either edge', () => {
  const empty = newSurvey('Appartement');
  const levelId = empty.levels[0].id;
  const { survey, roomId } = addRectangleRoom(empty, levelId, 'Cuisine', 0, 0, 4, 3);
  const wallId = survey.levels[0].rooms[0].walls[0].id;
  const left: SurveyTechnicalPoint = {
    id: 'left', wallId, model: 'elec-prise-32a', edge: 'left',
    distance_m: 0.8, height_m: 0.3, distanceMeasured: true, heightMeasured: true,
  };
  const right: SurveyTechnicalPoint = {
    ...left, id: 'right', edge: 'right', distance_m: 0.25, height_m: 0, model: 'plomb-evacuation',
  };
  const draft: SurveyTechnicalPoint = { ...left, id: 'draft', model: 'data-prise-rj45', distanceMeasured: undefined };
  const withPoints = [left, right, draft].reduce((s, point) => setTechnicalPoint(s, roomId, point), survey);
  expect(() => setTechnicalPoint(setRoomFrozen(withPoints, roomId, true), roomId, left)).toThrow();

  let restored = readSurveyFile(writeSurveyFile(withPoints, 'test'));
  expect(restored.levels[0].rooms[0].technicalPoints).toEqual([
    left, right, expect.objectContaining({ id: 'draft', height_m: 0.3 }),
  ]);
  expect(surveyChecks(restored).find(check => check.targetId === 'draft')).toBeUndefined();
  const preview = renderToStaticMarkup(createElement(SurveyPlan, { level: restored.levels[0] }));
  expect(preview.match(/data-survey-technical-point="measured"/g)).toHaveLength(2);
  expect(preview.match(/data-survey-technical-point="estimated"/g)).toHaveLength(1);
  expect(preview).toContain('Prise RJ45 réseau');
  expect(preview).toContain('>RJ45</text>');
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const attach = (model: typeof items) => applyAssociation(model, restored, storey.parentId!, [{ levelId, target: storey.id }]).items;
  const points = (model: typeof items) => Object.values(model).filter(i => i.type === 'Technical');
  const first = reconstructStorey(attach(items), storey.id);
  const [leftItem, rightItem, draftItem] = points(first.items);

  expect(points(first.items)).toHaveLength(3);
  expect(leftItem.model).toBe(left.model);
  expect(leftItem.geom.x).toBeCloseTo(3.2);
  expect(leftItem.geom.y).toBeCloseTo(0);
  expect(leftItem.geom.mountHeight).toBe(0.3);
  expect(Math.abs(leftItem.geom.rotation)).toBeCloseTo(Math.PI);
  expect(rightItem.geom.x).toBeCloseTo(0.25);
  expect(rightItem.geom.mountHeight).toBe(0);
  expect(rightItem.diameter).toBe(40);
  expect(draftItem.geom.x).toBeCloseTo(3.2);
  expect(draftItem.geom.mountHeight).toBe(0.3);

  restored = setWallLength(restored, roomId, wallId, 5);
  restored = setTechnicalPoint(restored, roomId, { ...draft, distance_m: 1.2, distanceMeasured: true });
  const second = reconstructStorey(attach(first.items), storey.id);
  expect(points(second.items)).toHaveLength(3);
  expect(points(second.items).find(p => p.id === leftItem.id)!.geom.x).toBeCloseTo(4.2);
  expect(points(second.items).find(p => p.id === rightItem.id)!.geom.x).toBeCloseTo(0.25);
  expect(points(second.items).find(p => p.id === draftItem.id)!.geom.x).toBeCloseTo(3.8);
  expect(second.updated).toContain(leftItem.id);
  expect(second.updated).not.toContain(rightItem.id);
  expect(surveyRefOf(second.items[rightItem.id])?.technicalPointId).toBe('right');
  const noop = () => {};
  const drawing = renderToStaticMarkup(createElement(Canvas2D, {
    items: second.items, storeyId: storey.id, tool: 'select', setTool: noop, selection: [], setSelection: noop,
    addItem: noop, updateItem: noop, deleteItems: noop, snapSize: 0.1, showGrid: false, snapEnabled: false,
    t: key => key, lang: 'fr', view: { scale: 40, ox: 50, oy: 200 }, setView: noop,
  }));
  expect(drawing.match(/data-technical-id=/g)).toHaveLength(3);
  expect(drawing).toContain('>RJ45</text>');
  expect(drawing).toContain('opacity="0.92"');
  expect(drawing.indexOf('data-technical-id=')).toBeGreaterThan(drawing.indexOf('opacity="0.92"'));

  restored = deleteTechnicalPoint(restored, roomId, right.id);
  expect(reconstructStorey(attach(second.items), storey.id).deleted).toContain(rightItem.id);
});

it('projects a visual position proportionally and a measured cote in metres', () => {
  const empty = newSurvey('Appartement');
  const { survey } = addRectangleRoom(empty, empty.levels[0].id, 'Cuisine', 0, 0, 4, 3);
  const [room] = survey.levels[0].rooms;
  const wall = { ...room.walls[0], length_m: 8 };
  const point: SurveyTechnicalPoint = { id: 'outlet', wallId: wall.id, model: 'elec-prise-simple', edge: 'left', distance_m: 2, height_m: 0.9 };
  expect(technicalPointPlanPosition(point, room, wall)?.x).toBeCloseTo(3);
  expect(technicalPointPlanPosition({ ...point, distanceMeasured: true }, room, wall)?.x).toBeCloseTo(2);
});

it('validates technical models and wall references before export', () => {
  const empty = newSurvey('Appartement');
  const { survey } = addRectangleRoom(empty, empty.levels[0].id, 'Cuisine', 0, 0, 4, 3);
  const room = survey.levels[0].rooms[0];
  room.technicalPoints = [{ id: 'bad', model: 'unknown', wallId: room.walls[0].id, edge: 'left', distance_m: 1, height_m: 1 }];
  expect(() => writeSurveyFile(survey, 'test')).toThrow(/point technique invalide/i);
  room.technicalPoints[0] = { ...room.technicalPoints[0], model: 'elec-prise-simple', wallId: 'missing' };
  expect(() => writeSurveyFile(survey, 'test')).toThrow(/point technique invalide/i);
});

it('imports, reconstructs and provides a 2D symbol for every technical catalogue model', () => {
  expect(editorCatalogue).toBe(TECHNICAL_CATALOGUE);
  const empty = newSurvey('Catalogue');
  const levelId = empty.levels[0].id;
  const { survey, roomId } = addRectangleRoom(empty, levelId, 'Cuisine', 0, 0, 4, 3);
  const wallId = survey.levels[0].rooms[0].walls[0].id;
  const withPoints = TECHNICAL_CATALOGUE.reduce((current, model, i) => setTechnicalPoint(current, roomId, {
    id: model.id, model: model.id, wallId, edge: 'left', distance_m: 4 * (i + 1) / (TECHNICAL_CATALOGUE.length + 1), height_m: 0.42,
    distanceMeasured: true, heightMeasured: true,
  }), survey);
  const restored = readSurveyFile(writeSurveyFile(withPoints, 'test'));
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const attached = applyAssociation(items, restored, storey.parentId!, [{ levelId, target: storey.id }]);
  const rebuilt = reconstructStorey(attached.items, storey.id);
  const technical = Object.values(rebuilt.items).filter(i => i.type === 'Technical');
  expect(technical).toHaveLength(TECHNICAL_CATALOGUE.length);
  for (const def of TECHNICAL_CATALOGUE) {
    expect(technical.find(p => p.model === def.id), def.id).toMatchObject({
      ifcType: def.ifcType, discipline: def.discipline, category: def.category,
      diameter: def.defaults.diameter, fluidType: def.defaults.fluidType, geom: { mountHeight: 0.42 },
    });
    const symbol = renderToStaticMarkup(createElement('svg', null, renderTechnicalSymbol(def.symbolKey, 40, 40, 'black')));
    expect(symbol, def.id).not.toContain('>?</text>');
  }
});

it('keeps points on the correct faces of a shared wall', () => {
  const empty = newSurvey('Appartement');
  const levelId = empty.levels[0].id;
  const a = addRectangleRoom(empty, levelId, 'Cuisine', 0, 0, 4, 3);
  const aWall = a.survey.levels[0].rooms[0].walls[0].id;
  const door = addOpening(a.survey, a.roomId, aWall, 'door', 1);
  const b = addAdjacentRoom(door.survey, a.roomId, door.openingId, 'Entrée');
  const bWall = b.survey.levels[0].rooms[1].walls[0].id;
  const point: SurveyTechnicalPoint = {
    id: 'point-a', wallId: aWall, model: 'elec-prise-simple', edge: 'left',
    distance_m: 0.2, height_m: 0.3, distanceMeasured: true, heightMeasured: true,
  };
  const s = setTechnicalPoint(setTechnicalPoint(b.survey, a.roomId, point), b.roomId, { ...point, id: 'point-b', wallId: bWall });
  const items = buildEmpty();
  const storey = Object.values(items).find(i => i.type === 'Storey')!;
  const attached = applyAssociation(items, s, storey.parentId!, [{ levelId, target: storey.id }]);
  const { items: rebuilt } = reconstructStorey(attached.items, storey.id);
  const points = Object.values(rebuilt).filter(i => i.type === 'Technical');
  expect(points).toHaveLength(2);
  const [onA, onB] = points;
  expect(onA.geom.y - onB.geom.y).toBeCloseTo(0.2);
  expect(onA.geom.x).toBeCloseTo(3.8);
  expect(onB.geom.x).toBeCloseTo(0.2);
  expect(Math.cos(onA.geom.rotation - onB.geom.rotation)).toBeCloseTo(-1);
});
