// Writes the sample relevé used for tests and manual imports: pnpm exec tsx --conditions=@skaitch/source scripts/survey-sample.ts
import { writeFileSync } from 'node:fs';
import { writeSurveyFile, type Survey } from '@skaitch/core/survey/surveyFile';

const w = 4.32, d = 3.65;
const survey: Survey = {
  id: 'srv_exemple', name: 'Exemple — appartement', createdAt: '2026-11-17T09:00:00.000Z', updatedAt: '2026-11-17T09:30:00.000Z',
  levels: [{
    id: 'rdc', name: 'RDC', rooms: [{
      id: 'room_salon', name: 'Salon', geometryStatus: 'assumed', ceilingHeight_m: 2.5,
      polygon: [[0, 0], [w, 0], [w, d], [0, d]],
      walls: [w, d, w, d].map((length_m, i) => ({
        id: `wall_${i + 1}`, from: i, to: (i + 1) % 4, length_m, source: 'laser' as const, locked: true,
        thickness_m: i === 0 ? 0.3 : 0.1, thicknessStatus: i === 0 ? 'measured' as const : 'estimated' as const,
      })),
    }],
  }],
};
writeFileSync(new URL('../../../docs/survey/exemple-salon.skaitch-survey', import.meta.url), writeSurveyFile(survey, '0.1.0'));
