import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { buildEmpty } from '@skaitch/core/data/starter';
import { readSkaitchFile, writeSkaitchFile, SKAITCH_FORMAT_VERSION, SkaitchFileError } from '@skaitch/core/file/skaitchFile';

const meta = { name: 'Maison', description: 'Test', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function withPlan() {
  const items = buildEmpty();
  const storey = Object.values(items).find(item => item.type === 'Storey')!;
  (storey as any).geom = { ...(storey as any).geom, plan: { url: png, w: 1, h: 1, opacity: 0.5, scale: 0.05, x: 0, y: 0, rotation: 0 } };
  return { items, storeyId: storey.id };
}

describe('.skaitch project file', () => {
  it('round-trips the model, catalogue, plan images and source IFC', () => {
    const { items } = withPlan();
    const catalogue = [{ id: 'cat_1', name: 'Bloc', category: 'custom' } as any];
    const sourceIfc = strToU8('ISO-10303-21;\nEND-ISO-10303-21;');
    const project = readSkaitchFile(writeSkaitchFile({ meta, items, catalogue, sourceIfc }, '0.4.0'));
    expect(project.meta).toEqual(meta);
    expect(project.items).toEqual(items);
    expect(project.catalogue).toEqual(catalogue);
    expect(strFromU8(project.sourceIfc!)).toBe('ISO-10303-21;\nEND-ISO-10303-21;');
  });

  it('stores vector background plan geometry as its own file and reads it back', () => {
    const { items, storeyId } = withPlan();
    const vector = { v: 1, unit: 'mm', origin: [700, 6600], w: 4000, h: 3000, layers: [{ name: 'A', color: '#ff0000', visible: true }],
      paths: [{ l: 0, c: '#ff0000', p: [0, 0, 4000, 0] }], texts: [], centers: [] };
    (items[storeyId] as any).geom.plan = { ...(items[storeyId] as any).geom.plan, kind: 'vector', vector };
    const bytes = writeSkaitchFile({ meta, items }, '0.7.0');
    const files = unzipSync(bytes);
    const model = JSON.parse(strFromU8(files['model.json']));
    const path = model[storeyId].geom.plan.vector;
    expect(path).toMatch(/^plans\/.+\.vector\.json$/);
    expect(JSON.parse(strFromU8(files[path]))).toEqual(vector);
    expect(readSkaitchFile(bytes).items).toEqual(items);
  });

  it('stores plan images as files, not inside model.json', () => {
    const { items, storeyId } = withPlan();
    const files = unzipSync(writeSkaitchFile({ meta, items }, '0.4.0'));
    const model = JSON.parse(strFromU8(files['model.json']));
    expect(model[storeyId].geom.plan.url).toBe(`plans/${storeyId}.png`);
    expect(files[`plans/${storeyId}.png`].subarray(1, 4)).toEqual(strToU8('PNG'));
    expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({ format: 'skaitch', formatVersion: SKAITCH_FORMAT_VERSION, appVersion: '0.4.0', project: meta });
    expect(files['catalogue.json']).toBeUndefined();
    expect(files['source.ifc']).toBeUndefined();
  });

  it('refuses files from a newer format version with an update message', () => {
    const file = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'skaitch', formatVersion: SKAITCH_FORMAT_VERSION + 1, appVersion: '9.0.0', project: meta })),
      'model.json': strToU8('{}'),
    });
    expect(() => readSkaitchFile(file)).toThrow(/version plus récente/);
  });

  it('rejects archives that are not skAItch projects', () => {
    expect(() => readSkaitchFile(strToU8('not a zip'))).toThrow(SkaitchFileError);
    expect(() => readSkaitchFile(zipSync({ 'model.json': strToU8('{}') }))).toThrow(SkaitchFileError);
    const other = zipSync({ 'manifest.json': strToU8('{"format":"other","formatVersion":1}'), 'model.json': strToU8('{}') });
    expect(() => readSkaitchFile(other)).toThrow(SkaitchFileError);
  });

  it('rejects plan references that point outside the plans folder or are missing', () => {
    const model = { s: { id: 's', type: 'Storey', geom: { plan: { url: '../secret.png' } } } };
    const file = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'skaitch', formatVersion: 1, appVersion: '0.4.0', project: meta })), 'model.json': strToU8(JSON.stringify(model)) });
    expect(() => readSkaitchFile(file)).toThrow(/Fond de plan manquant/);
  });
});
