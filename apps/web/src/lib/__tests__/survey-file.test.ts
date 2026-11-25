import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  readSurveyFile, writeSurveyFile, surveyWarnings, SurveyFileError, SURVEY_FORMAT_VERSION, type Survey,
} from '@skaitch/core/survey/surveyFile';

function rectangle(width: number, depth: number, lengths = [width, depth, width, depth]): Survey {
  return {
    id: 'srv_01', name: 'Appartement', createdAt: '2026-11-17T09:00:00.000Z', updatedAt: '2026-11-17T10:00:00.000Z',
    levels: [{
      id: 'rdc', name: 'RDC', rooms: [{
        id: 'room_salon', name: 'Salon', geometryStatus: 'assumed', ceilingHeight_m: 2.5,
        polygon: [[0, 0], [width, 0], [width, depth], [0, depth]],
        walls: lengths.map((length_m, i) => ({
          id: `wall_${i + 1}`, from: i, to: (i + 1) % 4, length_m, source: 'laser' as const, locked: true,
          thickness_m: 0.2, thicknessStatus: 'estimated' as const,
        })),
      }],
    }],
  };
}

const archive = (manifest: unknown, survey: unknown) => zipSync({
  'manifest.json': strToU8(JSON.stringify(manifest)),
  'survey.json': strToU8(JSON.stringify(survey)),
});

describe('survey file', () => {
  it('round-trips a survey without rounding lengths', () => {
    const survey = rectangle(4.3217, 3.1);
    expect(readSurveyFile(writeSurveyFile(survey, '0.1.0'))).toEqual(survey);
  });

  it('imports the committed sample file', () => {
    const bytes = readFileSync(new URL('../../../../../docs/survey/exemple-salon.skaitch-survey', import.meta.url));
    const survey = readSurveyFile(new Uint8Array(bytes));
    expect(survey.levels[0].rooms[0].walls).toHaveLength(4);
  });

  it('refuses a newer format version with an update message', () => {
    const file = archive({ format: 'skaitch-survey', formatVersion: SURVEY_FORMAT_VERSION + 1, appVersion: '9' }, rectangle(4, 3));
    expect(() => readSurveyFile(file)).toThrow(/version plus récente/);
  });

  it('refuses files that are not survey files', () => {
    expect(() => readSurveyFile(strToU8('not a zip'))).toThrow(SurveyFileError);
    expect(() => readSurveyFile(archive({ format: 'skaitch', formatVersion: 1 }, {}))).toThrow(/pas un fichier relevé/);
  });

  it('reports invalid content with an explicit message', () => {
    const bad = rectangle(4, 3);
    bad.levels[0].rooms[0].walls[1].length_m = 0;
    expect(() => writeSurveyFile(bad, '0.1.0')).toThrow(/wall_2.*longueur invalide/);

    const clockwise = rectangle(4, 3);
    clockwise.levels[0].rooms[0].polygon.reverse();
    expect(() => writeSurveyFile(clockwise, '0.1.0')).toThrow(/antihoraire/);

    const missing = rectangle(4, 3);
    missing.levels[0].rooms[0].walls.pop();
    expect(() => writeSurveyFile(missing, '0.1.0')).toThrow(/exactement un mur/);
  });

  it('warns about unequal opposite sides of an assumed rectangle instead of picking one', () => {
    const survey = rectangle(4.31, 3, [4.32, 3, 4.30, 3]);
    const warnings = surveyWarnings(survey);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].wallIds.sort()).toEqual(['wall_1', 'wall_3']);
    expect(survey.levels[0].rooms[0].walls.map(w => w.length_m)).toEqual([4.32, 3, 4.30, 3]);
    expect(surveyWarnings(rectangle(4, 3))).toEqual([]);
  });
});

import { roomLabelPoint } from '@skaitch/core/survey/surveyFile';
describe('room label position', () => {
  it('centres a rectangle and stays well inside an L', () => {
    expect(roomLabelPoint([[0, 0], [4, 0], [4, 3], [0, 3]])).toEqual([2, 1.5]);
    const [x, y] = roomLabelPoint([[5, 0], [5, 2], [2, 2], [2, 4], [0, 4], [0, 0]]);
    // Inside the L and at least 0.9 m from every wall (the arms are 2 m wide).
    expect(x < 2 || y < 2).toBe(true);
    expect(Math.min(x, y, 5 - x, (x > 2 ? 2 : 4) - y)).toBeGreaterThan(0.9);
  });
});

import { migrateSurvey } from '@skaitch/core/survey/surveyFile';
describe('format migrations', () => {
  it('a version 1 file still imports, with its implicit room shape made explicit', () => {
    const bytes = readFileSync(new URL('./fixtures-survey-v1.skaitch-survey', import.meta.url));
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(new Uint8Array(bytes))['manifest.json']));
    expect(manifest.formatVersion).toBe(1);
    const survey = readSurveyFile(new Uint8Array(bytes));
    expect(survey.levels[0].rooms[0].shape).toBe('rectangle');
    // Re-exported at the current version.
    const again = unzipSync(writeSurveyFile(survey, '0'));
    expect(JSON.parse(new TextDecoder().decode(again['manifest.json'])).formatVersion).toBe(SURVEY_FORMAT_VERSION);
  });

  it('migrates content saved without a version (app storage) and refuses a newer one', () => {
    const v1 = rectangle(4, 3);
    delete v1.levels[0].rooms[0].shape;
    const up = migrateSurvey(v1, 1) as typeof v1;
    expect(up.levels[0].rooms[0].shape).toBe('rectangle');
    expect(v1.levels[0].rooms[0].shape).toBeUndefined();
    expect(() => migrateSurvey(v1, SURVEY_FORMAT_VERSION + 1)).toThrow(/plus récente/);
  });
});
