import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';
import { addPhoto, addRectangleRoom, deletePhoto, deleteVertex, newSurvey, photoFile } from '@skaitch/core/survey/edit';
import { readSurveyArchive, readSurveyFile, writeSurveyFile, SurveyFileError } from '@skaitch/core/survey/surveyFile';

const now = new Date('2026-11-17T10:00:00Z');
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function withPhotos() {
  let s = newSurvey('x', now);
  const r = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
  s = addPhoto(r.survey, r.roomId, { kind: 'wall', wallId: `${r.roomId}_w2` }, { id: 'ph1', width: 2048, height: 1536 }, now);
  s = addPhoto(s, r.roomId, { kind: 'ceiling' }, { id: 'ph2', width: 1536, height: 2048 }, now);
  return { survey: s, roomId: r.roomId };
}

describe('survey photos', () => {
  it('travel in the archive under photos/, referenced from the survey', () => {
    const { survey } = withPhotos();
    const bytes = writeSurveyFile(survey, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'photos/ph1.jpg', 'photos/ph2.jpg', 'survey.json']);
    const back = readSurveyArchive(bytes);
    expect(back.survey).toEqual(survey);
    expect(back.photos['photos/ph1.jpg']).toEqual(jpeg);
    expect(back.survey.levels[0].rooms[0].photos!.map(p => p.surface.kind)).toEqual(['wall', 'ceiling']);
  });

  it('refuses a survey whose photo is missing, on export and on import', () => {
    const { survey } = withPhotos();
    expect(() => writeSurveyFile(survey, '0', { [photoFile('ph1')]: jpeg })).toThrow(/Photo manquante/);
    const broken = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'skaitch-survey', formatVersion: 1, appVersion: '0' })),
      'survey.json': strToU8(JSON.stringify(survey)),
    });
    expect(() => readSurveyFile(broken)).toThrow(SurveyFileError);
    expect(() => readSurveyFile(broken)).toThrow(/photo absente/);
  });

  it('rejects photos tied to an unknown wall, and keeps a merged wall photo on the remaining wall', () => {
    const { survey, roomId } = withPhotos();
    const bad = structuredClone(survey);
    (bad.levels[0].rooms[0].photos![0].surface as any).wallId = 'nope';
    expect(() => writeSurveyFile(bad, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg })).toThrow(/surface inconnue/);
    // Deleting P3 merges w2 and w3 into w2: the photo of w2 stays valid.
    const merged = deleteVertex(survey, roomId, 2, now);
    expect(merged.levels[0].rooms[0].photos![0].surface).toEqual({ kind: 'wall', wallId: `${roomId}_w2` });
    expect(deletePhoto(merged, roomId, 'ph2', now).levels[0].rooms[0].photos).toHaveLength(1);
    void strFromU8;
  });
});

import { applyAssociation } from '@skaitch/core/survey/association';
import { buildEmpty } from '@skaitch/core/data/starter';
describe('photos in the Survey tab', () => {
  it('each storey keeps the reduced copies of its own level photos', () => {
    const { survey } = withPhotos();
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')!;
    const out = applyAssociation(items, survey, storey.parentId!, [{ levelId: survey.levels[0].id, target: storey.id }], 1, { ph1: 'data:image/jpeg;base64,AA==', other: 'data:x' });
    expect((out.items[storey.id] as any).survey.photos).toEqual({ ph1: 'data:image/jpeg;base64,AA==' });
  });
});

import { addPhotoNote, updatePhotoNote, deletePhotoAnnotation } from '@skaitch/core/survey/edit';
describe('photo post-its', () => {
  it('adds, moves, edits and deletes a note stored relative to the image, and survives export', () => {
    const { survey, roomId } = withPhotos();
    const a = addPhotoNote(survey, roomId, 'ph1', [0.25, 0.4], 'Reprise enduit', now);
    let s = updatePhotoNote(a.survey, roomId, 'ph1', a.noteId, { at: [1.3, -0.2], text: 'Fissure' }, now);
    const note = s.levels[0].rooms[0].photos![0].annotations![0];
    expect(note).toMatchObject({ type: 'note', p: [1, 0], text: 'Fissure' });
    const back = readSurveyArchive(writeSurveyFile(s, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg }));
    expect(back.survey).toEqual(s);
    s = deletePhotoAnnotation(s, roomId, 'ph1', a.noteId, now);
    expect(s.levels[0].rooms[0].photos![0].annotations).toEqual([]);
    expect(() => updatePhotoNote(s, roomId, 'ph1', 'nope', { text: 'x' }, now)).toThrow(/introuvable/);
  });

  it('keeps a drawn post-it size, clamped to the image, through export', () => {
    const { survey, roomId } = withPhotos();
    const a = addPhotoNote(survey, roomId, 'ph1', [0.5, 0.5], '', now, [0.3, 0.2]);
    const s = updatePhotoNote(a.survey, roomId, 'ph1', a.noteId, { size: [1.4, 0.001] }, now);
    expect(s.levels[0].rooms[0].photos![0].annotations![0]).toMatchObject({ size: [1, 0.02] });
    expect(readSurveyArchive(writeSurveyFile(s, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg })).survey).toEqual(s);
  });

  it('restores a post-it display state from the archive and keeps it when editing its text', () => {
    const { survey, roomId } = withPhotos();
    const a = addPhotoNote(survey, roomId, 'ph1', [0.5, 0.5], 'Reprise enduit', now, [0.3, 0.2]);
    const roundTrip = (s: typeof survey) => readSurveyArchive(writeSurveyFile(s, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg })).survey;
    const getNote = (s: typeof survey) => s.levels[0].rooms[0].photos![0].annotations![0];
    expect(getNote(roundTrip(a.survey))).not.toHaveProperty('collapsed');
    const reduced = roundTrip(updatePhotoNote(a.survey, roomId, 'ph1', a.noteId, { collapsed: true }, now));
    const edited = updatePhotoNote(reduced, roomId, 'ph1', a.noteId, { text: 'Fissure', at: [0.7, 0.6] }, now);
    expect(getNote(roundTrip(edited))).toMatchObject({ collapsed: true, text: 'Fissure', p: [0.7, 0.6], size: [0.3, 0.2] });
    const opened = updatePhotoNote(edited, roomId, 'ph1', a.noteId, { collapsed: false }, now);
    expect(getNote(roundTrip(opened))).toMatchObject({ collapsed: false, text: 'Fissure' });
  });
});

import { addPhotoMeasure, updatePhotoMeasure } from '@skaitch/core/survey/edit';
describe('photo cotes', () => {
  it('keeps the typed value whatever the anchors (never derived from pixels), and survives export', () => {
    const { survey, roomId } = withPhotos();
    const a = addPhotoMeasure(survey, roomId, 'ph1', [0.1, 0.5], [0.6, 0.52], 2.1, now);
    let s = updatePhotoMeasure(a.survey, roomId, 'ph1', a.measureId, { p2: [0.9, 0.5] }, now);
    const m = s.levels[0].rooms[0].photos![0].annotations![0];
    expect(m).toMatchObject({ type: 'measure', p1: [0.1, 0.5], p2: [0.9, 0.5], value_m: 2.1, source: 'manual' });
    s = updatePhotoMeasure(s, roomId, 'ph1', a.measureId, { value: 2.15 }, now);
    expect(readSurveyArchive(writeSurveyFile(s, '0', { [photoFile('ph1')]: jpeg, [photoFile('ph2')]: jpeg })).survey).toEqual(s);
    expect(() => updatePhotoMeasure(s, roomId, 'ph1', a.measureId, { value: 0 }, now)).toThrow(/positive/);
  });
});

import { reconstructStorey, photosForElement } from '@skaitch/core/survey/reconstruct';
import { addAdjacentRoom, addOpening, setWallLength } from '@skaitch/core/survey/edit';
describe('photos from BIM elements', () => {
  it('a reconstructed wall shows the photos of both its faces, a space its floor and ceiling, after re-reconstruction too', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    s = setWallLength(a.survey, a.roomId, `${a.roomId}_w1`, 4, 'laser', now);
    const d = addOpening(s, a.roomId, `${a.roomId}_w1`, 'door', 1, now);
    const b = addAdjacentRoom(d.survey, a.roomId, d.openingId, 'Entrée', now);
    s = addPhoto(b.survey, a.roomId, { kind: 'wall', wallId: `${a.roomId}_w1` }, { id: 'pa', width: 10, height: 10 }, now);
    s = addPhoto(s, b.roomId, { kind: 'wall', wallId: `${b.roomId}_w1` }, { id: 'pb', width: 10, height: 10 }, now);
    s = addPhoto(s, a.roomId, { kind: 'ceiling' }, { id: 'pc', width: 10, height: 10 }, now);
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: s.id, surveyName: 'M', importedAt: '', level: s.levels[0], photos: { pa: 'data:a', pb: 'data:b', pc: 'data:c' } };
    let out = reconstructStorey(items, storey.id).items;
    const find = (pred: (i: any) => boolean) => Object.values(out).find(pred) as any;
    const wall = find(i => i.surveyRef?.wallId === `${a.roomId}_w1` && i.type === 'Wall');
    expect(photosForElement(out, wall.id).map(p => [p.id, p.roomName])).toEqual([['pa', 'Salon'], ['pb', 'Entrée']]);
    const salon = find(i => i.type === 'Room' && i.name === 'Salon');
    expect(photosForElement(out, salon.id).map(p => p.surface)).toEqual(['ceiling']);
    out = reconstructStorey(out, storey.id).items;
    expect(photosForElement(out, wall.id)).toHaveLength(2);
    expect(photosForElement(out, find(i => i.type === 'Door').id)).toEqual([]);
  });
});

import { exportIFC } from '@skaitch/core/bim/exportIFC';
import { ifcPhotoFiles, surveyPhotoPath } from '@skaitch/core/survey/ifcPhotos';
describe('IFC4 export with media', () => {
  it('references each photo from its wall or space and delivers the image files beside the model', () => {
    let s = newSurvey('M', now);
    const a = addRectangleRoom(s, s.levels[0].id, 'Salon', 0, 0, 4, 3, now);
    s = addPhoto(a.survey, a.roomId, { kind: 'wall', wallId: `${a.roomId}_w2` }, { id: 'pw', width: 10, height: 10 }, now);
    s = addPhoto(s, a.roomId, { kind: 'floor' }, { id: 'pf', width: 10, height: 10 }, now);
    const items = buildEmpty();
    const storey = Object.values(items).find(i => i.type === 'Storey')! as any;
    storey.survey = { surveyId: s.id, surveyName: 'M', importedAt: '', level: s.levels[0], photos: { pw: 'data:image/jpeg;base64,/9j/2Q==', pf: 'data:image/jpeg;base64,/9j/2Q==' } };
    const out = reconstructStorey(items, storey.id).items;
    const ifc = exportIFC(out);
    const docs = ifc.match(/IFCDOCUMENTREFERENCE\([^;]*/g) ?? [];
    expect(docs).toHaveLength(2);
    expect(docs.join()).toContain(`'${surveyPhotoPath('pw')}'`);
    expect(docs.join()).toMatch(/Photo du relevé — Salon, Mur/);
    expect((ifc.match(/IFCRELASSOCIATESDOCUMENT\(/g) ?? []).length).toBe(2);
    const files = ifcPhotoFiles(out);
    expect(Object.keys(files).sort()).toEqual(['photos/pf.jpg', 'photos/pw.jpg']);
    expect([...files['photos/pw.jpg'].subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });
});
