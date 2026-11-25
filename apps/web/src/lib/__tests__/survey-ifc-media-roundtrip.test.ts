import { describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import { buildEmpty } from '@skaitch/core/data/starter';
import { addPhoto, addRectangleRoom, newSurvey } from '@skaitch/core/survey/edit';
import { reconstructStorey } from '@skaitch/core/survey/reconstruct';
import { exportIFC } from '@skaitch/core/bim/exportIFC';

describe('IFC with survey photos', () => {
  it('is read back by web-ifc with its document references and associations', async () => {
    let s = newSurvey('M');
    const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3);
    s = addPhoto(a.survey, a.roomId, { kind: 'wall', wallId: `${a.roomId}_w1` }, { id: 'pw', width: 10, height: 10 });
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: s.id, surveyName: 'M', importedAt: '', level: s.levels[0], photos: { pw: 'data:image/jpeg;base64,/9j/2Q==' } };
    const ifc = exportIFC(reconstructStorey(items, storey.id).items);
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const model = api.OpenModel(new TextEncoder().encode(ifc));
    const refs = api.GetLineIDsWithType(model, WebIFC.IFCDOCUMENTREFERENCE);
    expect(refs.size()).toBe(1);
    const ref = api.GetLine(model, refs.get(0));
    expect(ref.Location.value).toBe('photos/pw.jpg');
    const rels = api.GetLineIDsWithType(model, WebIFC.IFCRELASSOCIATESDOCUMENT);
    const rel = api.GetLine(model, rels.get(0));
    const wall = api.GetLine(model, rel.RelatedObjects[0].value);
    expect(wall.type).toBe(WebIFC.IFCWALL);
    api.CloseModel(model);
  });
});
