import type { MeasureSource, SurveyLevel, SurveyOpening, SurveyRoom, SurveyWall } from './surveyFile.js';
import { linkedFaces } from './surveyFile.js';
import { placeRooms } from './placement.js';

/**
 * Survey reliability (ADR 0016): summary level of a BIM element produced by the survey.
 * `modified` is never stored: it is read from the element (see `surveyReliability`).
 */
export type SurveyReliability = 'measured' | 'partial' | 'assumed' | 'modified';
export type StoredReliability = Exclude<SurveyReliability, 'modified'>;

/** Sources typed on site; `estimated` and `computed` never count as measured. */
const MEASURED_SOURCES: readonly MeasureSource[] = ['laser', 'tape', 'manual'];

export interface LevelReliability {
  room(roomId: string): StoredReliability;
  /** A wall face, as carried by the BIM wall (or by its cote). */
  wall(roomId: string, wallId: string): StoredReliability;
  opening(roomId: string, opening: SurveyOpening): StoredReliability;
}

/** Computes the reliability of every room, wall face and opening of a survey level. */
export function levelReliability(level: SurveyLevel): LevelReliability {
  const placement = placeRooms(level);
  const assumedRoom = new Map<string, boolean>(level.rooms.map(r =>
    [r.id, r.geometryStatus === 'assumed' || placement.rooms.get(r.id)?.status === 'assumed']));

  const thicknessMeasured = (wall: SurveyWall) =>
    wall.thicknessStatus === 'measured' || linkedFaces(level, wall).some(l => l.wall.thicknessStatus === 'measured');

  const wall = (roomId: string, wallId: string): StoredReliability => {
    if (assumedRoom.get(roomId)) return 'assumed';
    const room = level.rooms.find(r => r.id === roomId);
    const w = room?.walls.find(x => x.id === wallId);
    if (!w) return 'partial';
    return MEASURED_SOURCES.includes(w.source) && thicknessMeasured(w) ? 'measured' : 'partial';
  };

  const room = (roomId: string): StoredReliability => {
    if (assumedRoom.get(roomId)) return 'assumed';
    const r: SurveyRoom | undefined = level.rooms.find(x => x.id === roomId);
    if (!r || r.ceilingHeight_m === undefined) return 'partial';
    return r.walls.every(w => wall(roomId, w.id) === 'measured') ? 'measured' : 'partial';
  };

  const opening = (roomId: string, o: SurveyOpening): StoredReliability => {
    const host = wall(roomId, o.wallId);
    if (host !== 'measured') return host;
    return o.width_m > 0 && o.height_m > 0 && (o.kind === 'door' || o.sill_m !== undefined) ? 'measured' : 'partial';
  };

  return { room, wall, opening };
}

/** Colours of the Reliability view mode and of the properties panel (ADR 0016). */
export const RELIABILITY_COLORS: Record<SurveyReliability, string> = {
  measured: '#2e9d57', partial: '#e08a1e', assumed: '#d23c3c', modified: '#8a8f98',
};

export function reliabilityLabel(r: SurveyReliability, lang: string): string {
  const fr = lang === 'fr';
  return {
    measured: fr ? 'Mesuré' : 'Measured',
    partial: fr ? 'Partiellement estimé' : 'Partly estimated',
    assumed: fr ? 'Supposé' : 'Assumed',
    modified: fr ? 'Modifié dans skAItch' : 'Modified in skAItch',
  }[r];
}
