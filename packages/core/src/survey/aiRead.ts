import type { IfcEntity, IfcStoreyEntity, ItemsMap } from '../types/ifc.js';
import { placeRooms } from './placement.js';
import { photosForElement, surveyRefOf, surveyReliability } from './reconstruct.js';
import { levelReliability } from './reliability.js';
import { surveyDefaults, type PhotoAnnotation, type SurveyRoom } from './surveyFile.js';

/**
 * Read-only views of a storey's survey for the AI tools (ADR 0017): structured text without image
 * data, and one photo at a time with its annotations. The AI never edits the survey.
 */

const round = (v: number) => Math.round(v * 1000) / 1000;

function annotationsForAi(annotations: PhotoAnnotation[] = []) {
  return annotations.map(a => a.type === 'note'
    ? { type: 'note' as const, at: a.p, text: a.text }
    : { type: 'measure' as const, from: a.p1, to: a.p2, value_m: a.value_m, source: a.source });
}

/** BIM elements produced by each survey object, so the AI can go from the survey to the model. */
function producedElements(items: ItemsMap, storeyId: string, surveyId: string) {
  const byKey = new Map<string, { id: string; type: string }[]>();
  for (const item of Object.values(items)) {
    const ref = surveyRefOf(item);
    if (!ref || item.parentId !== storeyId || ref.surveyId !== surveyId || ref.dimension || ref.technicalPointId || ref.furnitureId) continue;
    const key = ref.openingId ? `o|${ref.roomId}|${ref.openingId}` : ref.wallId ? `w|${ref.roomId}|${ref.wallId}` : `r|${ref.roomId}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push({ id: item.id, type: item.type });
  }
  return (key: string) => {
    const found = byKey.get(key) ?? [];
    return found.map(f => ({ ...f, reliability: surveyReliability(items[f.id]) }));
  };
}

export function getSurveyForAi(items: ItemsMap, storeyId: string) {
  const storey = items[storeyId] as IfcStoreyEntity | undefined;
  if (!storey || storey.type !== 'Storey') return { error: `Storey not found: ${storeyId}` };
  const survey = storey.survey;
  if (!survey) return { storey_id: storeyId, survey: null, note: 'No survey is associated with this storey.' };
  const level = survey.level;
  const placement = placeRooms(level);
  const reliability = levelReliability(level);
  const produced = producedElements(items, storeyId, survey.surveyId);
  const defaults = surveyDefaults(survey);
  const room = (r: SurveyRoom) => ({
    id: r.id, name: r.name,
    geometry: r.geometryStatus,
    placement: placement.rooms.get(r.id)?.status ?? 'unplaced',
    reliability: reliability.room(r.id),
    frozen: !!r.frozen,
    ceiling_height_m: r.ceilingHeight_m ?? null,
    ceiling_height_is_default: r.ceilingHeight_m === undefined,
    polygon_m: r.polygon.map(p => [round(p[0]), round(p[1])]),
    walls: r.walls.map(w => ({
      id: w.id, name: w.name ?? `P${w.from + 1}–P${w.to + 1}`, face_length_m: w.length_m, source: w.source, locked: w.locked,
      thickness_m: w.thickness_m, thickness_status: w.thicknessStatus, reliability: reliability.wall(r.id, w.id),
      linked_faces: (w.links ?? []).map(l => ({ room_id: l.roomId, wall_id: l.wallId, offset_m: l.offset_m, offset_status: l.offsetStatus ?? 'estimated' })),
      aligned_faces: (w.alignments ?? []).map(a => ({ room_id: a.roomId, wall_id: a.wallId, step_m: a.step_m })),
      bim: produced(`w|${r.id}|${w.id}`),
    })),
    openings: (r.openings ?? []).map(o => ({
      id: o.id, kind: o.kind, operation: o.operation, wall_id: o.wallId, offset_m: o.offset_m, width_m: o.width_m, height_m: o.height_m,
      sill_m: o.kind === 'window' ? o.sill_m ?? null : undefined, hinge: o.hinge, swing: o.swing,
      reliability: reliability.opening(r.id, o), bim: produced(`o|${r.id}|${o.id}`),
    })),
    diagonals: (r.diagonals ?? []).map(d => ({ from: `P${d.from + 1}`, to: `P${d.to + 1}`, length_m: d.length_m, source: d.source })),
    angles: (r.angles ?? []).map(a => ({ vertex: `P${a.vertex + 1}`, deg: a.deg })),
    photos: (r.photos ?? []).map(p => ({
      id: p.id, surface: p.surface.kind, wall_id: p.surface.kind === 'wall' ? p.surface.wallId : undefined, taken_at: p.takenAt,
      available: !!survey.photos?.[p.id], annotations: annotationsForAi(p.annotations),
    })),
    bim: produced(`r|${r.id}`),
  });
  return {
    storey_id: storeyId,
    survey: { id: survey.surveyId, name: survey.surveyName, imported_at: survey.importedAt, level: level.name },
    defaults,
    reference_room_id: placement.referenceId,
    rooms: level.rooms.map(room),
    closure_checks: placement.closures.map(c => ({ room_ids: c.roomIds, wall_ids: c.wallIds, gap_m: round(c.gap), message: c.message })),
    suggested_cote: placement.next?.message ?? null,
    notes: 'Read-only. Face lengths are measured on the finished inner face. Photo annotation positions are relative to the image (0–1, origin top-left). Photo cotes are typed on site, never derived from pixels. Use get_survey_photo to see a photo.',
  };
}

export function getSurveyPhotoForAi(items: ItemsMap, photoId: string) {
  for (const storey of Object.values(items)) {
    const survey = storey.type === 'Storey' ? (storey as IfcStoreyEntity).survey : undefined;
    if (!survey) continue;
    for (const r of survey.level.rooms) {
      const p = r.photos?.find(x => x.id === photoId);
      if (!p) continue;
      const url = survey.photos?.[p.id];
      return {
        photo_id: p.id, storey_id: storey.id, room: { id: r.id, name: r.name },
        surface: p.surface.kind, wall_id: p.surface.kind === 'wall' ? p.surface.wallId : undefined, taken_at: p.takenAt,
        annotations: annotationsForAi(p.annotations),
        ...(url ? { image_url: url } : { error: 'The image of this photo is not in the project.' }),
      };
    }
  }
  return { error: `Survey photo not found: ${photoId}` };
}

/**
 * What get_element_properties returns: the element without heavy survey payloads (a storey's
 * survey and photos), plus its survey reliability and the ids of its photos.
 */
export function elementForAi(items: ItemsMap, item: IfcEntity) {
  if (item.type === 'Storey' && (item as IfcStoreyEntity).survey) {
    const { survey, ...rest } = item as IfcStoreyEntity;
    return { ...rest, survey: { id: survey!.surveyId, name: survey!.surveyName, imported_at: survey!.importedAt, note: 'Call get_survey for its content.' } };
  }
  const reliability = surveyReliability(item);
  if (!reliability) return item;
  const { surveyRef, ...rest } = item as IfcEntity & { surveyRef?: unknown };
  return { ...rest, survey_reliability: reliability, survey_photo_ids: photosForElement(items, item.id).map(p => p.id) };
}
