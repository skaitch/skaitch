import { globalPlan } from './globalPlan.js';
import { solveRoom } from './solve.js';
import { placeRooms } from './placement.js';
import { isLinked, surveyDefaults, surveyWarnings, technicalPointReady, type Survey, type SurveyRoom, type SurveyTechnicalPoint, type SurveyWall } from './surveyFile.js';
import { TECHNICAL_CATALOGUE } from '../data/technicalCatalogue.js';
import { tr } from './lang.js';

/**
 * Survey check (spec F-29, §3.4): what is missing or inconsistent before export, each item
 * pointing at the room (and wall or opening) to fix. Export stays possible; nothing is changed.
 */
export interface SurveyCheck {
  severity: 'error' | 'warning' | 'info';
  roomId: string;
  /** Wall, opening or control measurement to show. */
  targetId?: string;
  message: string;
}

export function technicalPointProblem(point: SurveyTechnicalPoint, room: SurveyRoom, wall: SurveyWall, height: number) {
  return technicalPointReady(point, room, wall, height) ? null : tr('Les cotes placent le point hors du mur.', 'The dimensions place the point outside the wall.');
}

export function technicalPointChecks(room: SurveyRoom, height: number): SurveyCheck[] {
  const checks: SurveyCheck[] = [];
  for (const point of room.technicalPoints ?? []) {
    const wall = room.walls.find(w => w.id === point.wallId);
    const model = TECHNICAL_CATALOGUE.find(m => m.id === point.model);
    if (!wall || !model) continue;
    const problem = technicalPointProblem(point, room, wall, height);
    if (problem) {
      const name = tr(model.labelFr, model.labelEn);
      checks.push({ severity: 'warning', roomId: room.id, targetId: point.id,
        message: `${room.name} · ${name}. ${problem}` });
    }
  }
  return checks;
}

export function surveyChecks(survey: Survey): SurveyCheck[] {
  const checks: SurveyCheck[] = [];
  const warnings = surveyWarnings(survey);
  for (const level of survey.levels) {
    if (!level.rooms.length) checks.push({ severity: 'error', roomId: '', message: tr(`Niveau « ${level.name} » : aucune pièce relevée.`, `Level “${level.name}”: no room surveyed.`) });
    const plan = globalPlan(level);
    const placement = placeRooms(level);
    for (const room of level.rooms) {
      const unmeasured = room.walls.filter(w => !w.locked && w.source !== 'computed');
      if (unmeasured.length) {
        const walls = unmeasured.map(w => `P${w.from + 1}–P${w.to + 1}`).join(', ');
        checks.push({ severity: 'error', roomId: room.id, targetId: unmeasured[0].id,
          message: tr(`${room.name} : ${unmeasured.length} mur(s) sans cote mesurée (${walls}).`, `${room.name}: ${unmeasured.length} wall(s) without a measured dimension (${walls}).`) });
      }
      const solved = solveRoom(room);
      if (!unmeasured.length && solved.status === 'underconstrained' && !placement.rooms.get(room.id)!.resolvedByNeighbours) checks.push({ severity: 'warning', roomId: room.id, message: tr(`${room.name} : ${solved.hint}`, `${room.name}: ${solved.hint}`) });
      if (room.ceilingHeight_m === undefined) checks.push({ severity: 'info', roomId: room.id, message: tr(`${room.name} : hauteur sous plafond non renseignée (${surveyDefaults(survey).ceilingHeight_m.toFixed(2).replace('.', ',')} m par défaut).`, `${room.name}: ceiling height not entered (${surveyDefaults(survey).ceilingHeight_m.toFixed(2)} m by default).`) });
      const estimated = room.walls.filter(w => w.thicknessStatus === 'estimated' && !isLinked(w)).length;
      if (estimated) checks.push({ severity: 'info', roomId: room.id, message: tr(`${room.name} : épaisseur estimée pour ${estimated} mur(s).`, `${room.name}: thickness estimated for ${estimated} wall(s).`) });
      checks.push(...technicalPointChecks(room, room.ceilingHeight_m ?? surveyDefaults(survey).ceilingHeight_m));
    }
    for (const room of plan.unplaced) {
      checks.push({ severity: 'warning', roomId: room.id, message: tr(`${room.name} : pièce non positionnée par rapport à la pièce de référence (liez un de ses murs à une pièce placée, ou créez-la depuis une porte).`, `${room.name}: room not placed relative to the reference room (link one of its walls to a placed room, or create it from a door).`) });
    }
    for (const d of plan.discrepancies) checks.push({ severity: 'warning', roomId: d.roomId, targetId: d.wallIds[0], message: d.message });
    // Room placement (ADR 0012): assumed placements, drawings to replace, loops that do not close.
    for (const s of placement.suggestions) if (s.kind === 'offset' || s.kind === 'thickness')
      checks.push({ severity: 'warning', roomId: s.roomId, targetId: s.wallId, message: s.message });
    for (const p of placement.rooms.values()) if (p.toReplace) {
      const room = level.rooms.find(r => r.id === p.roomId)!;
      checks.push({ severity: 'warning', roomId: p.roomId, message: tr(`${room.name} : à replacer, le dessin ne correspond plus aux cotes.`, `${room.name}: to replace, the drawing no longer matches the cotes.`) });
    }
    for (const c of placement.closures) checks.push({ severity: 'warning', roomId: c.roomIds[0], targetId: c.wallIds[0], message: c.message });
  }
  for (const w of warnings) checks.push({ severity: 'warning', roomId: w.roomId, targetId: w.wallIds[0], message: w.message });
  const order = { error: 0, warning: 1, info: 2 };
  return checks.sort((a, b) => order[a.severity] - order[b.severity]);
}
