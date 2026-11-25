import type { IfcStoreyEntity, ItemsMap } from '../types/ifc.js';
import { guid } from '../data/starter.js';
import type { Survey } from './surveyFile.js';
import { tr } from './lang.js';

/**
 * Level association (CONTEXT.md): where each survey level goes at import.
 * `target` is an existing storey id, 'new' to create a storey, or null to leave the level out.
 */
export interface LevelAssociation {
  levelId: string;
  target: string | 'new' | null;
}

const STOREY_SPACING = 3;

function buildingStoreys(items: ItemsMap, buildingId: string) {
  return Object.values(items)
    .filter((i): i is IfcStoreyEntity => i.type === 'Storey' && i.parentId === buildingId)
    .sort((a, b) => a.geom.elevation - b.geom.elevation);
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

/**
 * Proposed association: a level goes to the storey with the same name; otherwise the first
 * remaining level goes to the storey the import was started from; the others get new storeys.
 */
export function proposeAssociation(items: ItemsMap, survey: Survey, currentStoreyId: string): LevelAssociation[] {
  const current = items[currentStoreyId];
  if (!current || current.type !== 'Storey') throw new Error(`Storey not found: ${currentStoreyId}`);
  const storeys = buildingStoreys(items, current.parentId!);
  const used = new Set<string>();
  const result = survey.levels.map(level => {
    const same = storeys.find(s => !used.has(s.id) && norm(s.name) === norm(level.name));
    if (same) used.add(same.id);
    return { levelId: level.id, target: same?.id ?? null } as LevelAssociation;
  });
  const free = result.find(a => a.target === null);
  if (free && !used.has(currentStoreyId)) free.target = currentStoreyId;
  for (const a of result) if (a.target === null) a.target = 'new';
  return result;
}

/** Attaches survey levels to storeys, creating storeys on top of the building when asked. */
export function applyAssociation(
  items: ItemsMap, survey: Survey, buildingId: string, association: LevelAssociation[], now = Date.now(),
  /** Reduced copies of the survey photos (data URLs), by photo id; each storey keeps its level's. */
  photos: Record<string, string> = {},
): { items: ItemsMap; storeyIds: string[] } {
  if (items[buildingId]?.type !== 'Building') throw new Error(`Building not found: ${buildingId}`);
  const targets = association.map(a => a.target).filter((t): t is string => !!t && t !== 'new');
  if (new Set(targets).size !== targets.length) throw new Error(tr('Deux niveaux relevés ne peuvent pas être associés au même étage.', 'Two surveyed levels cannot be matched to the same storey.'));
  for (const t of targets) {
    if (items[t]?.type !== 'Storey' || items[t].parentId !== buildingId) throw new Error(tr(`Étage introuvable : ${t}`, `Storey not found: ${t}`));
  }
  const next: ItemsMap = { ...items };
  const storeys = buildingStoreys(items, buildingId);
  let top: IfcStoreyEntity | undefined = storeys[storeys.length - 1];
  let level = top ? Math.max(...storeys.map(s => s.geom.level)) : -1;
  const importedAt = new Date(now).toISOString();
  const storeyIds: string[] = [];
  association.forEach((a, i) => {
    if (!a.target) return;
    const surveyLevel = survey.levels.find(l => l.id === a.levelId);
    if (!surveyLevel) throw new Error(tr(`Niveau relevé introuvable : ${a.levelId}`, `Surveyed level not found: ${a.levelId}`));
    const levelPhotos = Object.fromEntries(surveyLevel.rooms.flatMap(r => (r.photos ?? []).filter(p => photos[p.id]).map(p => [p.id, photos[p.id]])));
    const attached = { surveyId: survey.id, surveyName: survey.name, importedAt, level: surveyLevel, ...(survey.defaults ? { defaults: survey.defaults } : {}), ...(Object.keys(levelPhotos).length ? { photos: levelPhotos } : {}) };
    if (a.target === 'new') {
      const id = `lvl_srv_${now}_${i}`;
      level++;
      const elevation = top ? top.geom.elevation + STOREY_SPACING : 0;
      const storey: IfcStoreyEntity = {
        id, type: 'Storey', ifcType: 'IfcBuildingStorey', name: surveyLevel.name, Name: surveyLevel.name,
        GlobalId: guid(id), parentId: buildingId, geom: { level, elevation, thickness: 0.3 }, grossArea: 0, survey: attached,
      };
      next[id] = storey;
      top = storey;
      storeyIds.push(id);
    } else {
      next[a.target] = { ...(items[a.target] as IfcStoreyEntity), survey: attached };
      storeyIds.push(a.target);
    }
  });
  return { items: next, storeyIds };
}
