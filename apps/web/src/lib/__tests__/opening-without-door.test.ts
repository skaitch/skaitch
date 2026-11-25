import { describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import { buildEmpty } from '@skaitch/core/data/starter';
import { BUILTIN_CATALOGUE } from '@skaitch/core/data/elementCatalogue';
import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { importIFCBuffer } from '@skaitch/core/bim/importIFC';
import { addOpening, addRectangleRoom, newSurvey, setWallLength, updateOpening } from '@skaitch/core/survey/edit';
import { reconstructStorey } from '@skaitch/core/survey/reconstruct';
import { readSurveyFile, writeSurveyFile, SURVEY_FORMAT_VERSION } from '@skaitch/core/survey/surveyFile';

function surveyWithPassage() {
  let s = newSurvey('M');
  const r = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3);
  s = setWallLength(r.survey, r.roomId, `${r.roomId}_w1`, 4, 'laser');
  const o = addOpening(s, r.roomId, `${r.roomId}_w1`, 'door', 2);
  return updateOpening(o.survey, r.roomId, o.openingId, { operation: 'none' });
}

describe('opening without a door', () => {
  it('is offered in the door catalogue', () => {
    expect(BUILTIN_CATALOGUE.find(d => d.id === 'door-opening')).toMatchObject({ type: 'Door', defaults: { OperationType: 'NONE' } });
  });

  it('is a door operation of the survey file (format 3) and rebuilds as a leafless door', () => {
    const s = surveyWithPassage();
    expect(SURVEY_FORMAT_VERSION).toBeGreaterThanOrEqual(3);
    expect(readSurveyFile(writeSurveyFile(s, '0'))).toEqual(s);
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: s.id, surveyName: 'M', importedAt: '', level: s.levels[0] };
    const door = Object.values(reconstructStorey(items, storey.id).items).find((i: any) => i.type === 'Door') as any;
    expect(door).toMatchObject({ OperationType: 'NONE', geom: { catalogueId: 'door-opening' } });
  });

  it('exports valid IFC4: USERDEFINED / NONE, no body, the wall still voided', async () => {
    const s = surveyWithPassage();
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: s.id, surveyName: 'M', importedAt: '', level: s.levels[0] };
    const ifc = exportIFC(reconstructStorey(items, storey.id).items);
    expect(ifc).not.toMatch(/\.NONE\.\)/);
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const model = api.OpenModel(new TextEncoder().encode(ifc));
    const doors = api.GetLineIDsWithType(model, WebIFC.IFCDOOR);
    expect(doors.size()).toBe(1);
    const door = api.GetLine(model, doors.get(0));
    expect(door.OperationType.value).toBe('USERDEFINED');
    expect(door.UserDefinedOperationType.value).toBe('NONE');
    expect(door.Representation).toBeNull();
    expect(api.GetLineIDsWithType(model, WebIFC.IFCRELVOIDSELEMENT).size()).toBe(1);
    api.CloseModel(model);
    // Read back by skAItch's importer as the same leafless door.
    const bytes = new TextEncoder().encode(ifc);
    const back = await importIFCBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), () => {});
    expect(Object.values(back.items).find((i: any) => i.type === 'Door')).toMatchObject({ OperationType: 'NONE' });
  });
});
