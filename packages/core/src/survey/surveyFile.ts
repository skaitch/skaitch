import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DEFAULT_TOLERANCE_M, solveRoom } from './solve.js';
import { tr } from './lang.js';
import { TECHNICAL_CATALOGUE } from '../data/technicalCatalogue.js';
import { BUILTIN_CATALOGUE, type ElementDef } from '../data/elementCatalogue.js';

/**
 * The survey file (ADR 0006): a ZIP archive produced by the Survey app
 * and imported in the Survey tab of a storey.
 *
 *   manifest.json   format marker, formatVersion, app version
 *   survey.json     levels, rooms and walls; lengths in metres, never rounded
 *
 * Every wall length is a "face length": measured on the finished inner face of the wall,
 * room side. Wall axes only appear at reconstruction, using the wall thickness.
 */
export const SURVEY_FORMAT = 'skaitch-survey';
/**
 * Format history:
 *   1  rooms, walls, face length (tranche 1)
 *   2  openings, linked faces, room shape, diagonals and angles, photos and their annotations
 *   3  door operation `none` (opening without a door)
 *   4  link offset status, reference room of a level (ADR 0012), frozen room, wall name, survey defaults
 *   5  several linked faces per face (ADR 0013): `shared` becomes the list `links`
 *   6  aligned faces: a wall that continues another room's wall (`alignments`)
 *   7  technical points positioned by wall elevation cotes
 *   8  furniture positioned on the room plan
 *   9  structure models in the furniture list: columns, chimneys and stoves (SURVEY_STRUCTURE_MODELS)
 */
export const SURVEY_FORMAT_VERSION = 9;
export const SURVEY_EXTENSION = '.skaitch-survey';
export const SURVEY_MIME = 'application/vnd.skaitch-survey+zip';
/** Sending to the account (ADR 0011): the file travels in pieces of this size, resumable one by one. */
export const SURVEY_UPLOAD_CHUNK = 700 * 1024;

const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;

export type MeasureSource = 'laser' | 'tape' | 'manual' | 'estimated' | 'computed';
export type ValueStatus = 'measured' | 'estimated';
/** "assumed": the shape relies on an explicit hypothesis (e.g. right angles), see "assumed geometry". */
export type GeometryStatus = 'assumed' | 'resolved';

export interface SurveyWall {
  /** Stable id; reconstruction correlates the BIM wall with it. */
  id: string;
  /** Indexes into the room polygon: the wall runs from vertex `from` to vertex `to`. */
  from: number;
  to: number;
  /** Inner face length in metres (face length). */
  length_m: number;
  source: MeasureSource;
  /** A locked length is never changed automatically. */
  locked: boolean;
  thickness_m: number;
  thicknessStatus: ValueStatus;
  /** Name given on site (« mur fenêtre », « cloison cuisine »); shown as P1–P2 when absent. */
  name?: string;
  /**
   * Linked faces (ADR 0008, 0013): each link names a face of another room that is the other side
   * of this wall over a common stretch; stretches of one face do not overlap. Read with `wallLinks`.
   */
  links?: FaceLink[];
  /** Aligned faces: walls of other rooms that continue this one, on the same line. */
  alignments?: FaceAlignment[];
}

/**
 * Aligned face: a face of another room that continues this face, the inner faces running the same
 * way on the same line (a façade along two rooms). `step_m` is a measured set-back between the two
 * face lines (positive: the other face lies further out); 0 when they are flush.
 */
export interface FaceAlignment {
  roomId: string;
  wallId: string;
  step_m: number;
  stepStatus?: ValueStatus;
}

/**
 * Link to the opposite face of the same physical wall, in a room of the same level.
 * The two faces run in opposite directions; `offset_m` is where the other face ends,
 * measured along this face from its start (0 when both faces start and end together).
 */
export interface FaceLink {
  roomId: string;
  wallId: string;
  offset_m: number;
  /** Link offset (ADR 0012): measured on site, or read from the drawing; absent means estimated. */
  offsetStatus?: ValueStatus;
}

export type OpeningKind = 'door' | 'window';
/** Mechanism, independent of its 2D symbol and of the IFC mapping (spec 10.1). */
/** `none`: a passage through the wall without a door leaf. */
export type OpeningOperation = 'single_swing' | 'double_swing' | 'sliding' | 'fixed' | 'tilt_turn' | 'none';
export const OPENING_OPERATIONS: Record<OpeningKind, OpeningOperation[]> = {
  door: ['single_swing', 'double_swing', 'sliding', 'none'],
  window: ['fixed', 'single_swing', 'double_swing', 'sliding', 'tilt_turn'],
};

export interface SurveyOpening {
  /** Stable id; reconstruction correlates the BIM door or window with it. */
  id: string;
  /** Host wall, in the same room. */
  wallId: string;
  kind: OpeningKind;
  operation: OpeningOperation;
  /** Distance from the wall's start vertex to the opening, along the inner face (cote « avant »). */
  offset_m: number;
  width_m: number;
  height_m: number;
  /** Windows only: height of the sill above the finished floor. */
  sill_m?: number;
  /** Hinged side, in the wall's drawing direction (from → to). */
  hinge: 'start' | 'end';
  /** Opens towards the room (in) or away from it (out). */
  swing: 'in' | 'out';
}

export interface SurveyTechnicalPoint {
  id: string;
  wallId: string;
  model: string;
  edge: 'left' | 'right';
  distance_m: number;
  height_m: number;
  /** A typed measurement takes precedence over the position placed in the elevation. */
  distanceMeasured?: true;
  heightMeasured?: true;
}

export function technicalPointOffset(point: SurveyTechnicalPoint, wallLength: number) {
  return point.edge === 'left' ? point.distance_m : wallLength - point.distance_m;
}

/** The end of a counter-clockwise wall face is on the left when viewed from inside the room. */
export function technicalPointPlanPosition(point: SurveyTechnicalPoint, room: SurveyRoom, wall: SurveyWall) {
  const [[ax, ay], [bx, by]] = [room.polygon[wall.from], room.polygon[wall.to]];
  const [dx, dy] = [bx - ax, by - ay];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const distance = Math.min(1, point.distance_m / (point.distanceMeasured ? length : wall.length_m));
  const t = point.edge === 'right' ? distance : 1 - distance;
  return { x: ax + t * dx, y: ay + t * dy, rotation: Math.atan2(-dy, -dx) };
}

export function technicalPointReady(point: SurveyTechnicalPoint, room: SurveyRoom, wall: SurveyWall, height: number) {
  const [a, b] = [room.polygon[wall.from], room.polygon[wall.to]];
  const drawnWidth = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return drawnWidth >= 1e-6 && point.distance_m <= wall.length_m && point.height_m <= height
    && (!point.distanceMeasured || point.distance_m <= drawnWidth + 1e-6);
}

/**
 * Columns and chimneys are placed like furniture (centre, width, depth, height, rotation) but become
 * IfcColumn / IfcChimney at reconstruction. A round column uses width as its diameter.
 * Survey-only entries: not part of the editor's element library.
 */
export const SURVEY_STRUCTURE_CATEGORY = 'Structure';
export const SURVEY_STRUCTURE_MODELS: (ElementDef & { structure: { type: 'Column'; shape: 'rect' | 'circle' } | { type: 'Chimney'; kind: 'flue' | 'fireplace' | 'stove' } })[] = [
  { id: 'structure-column', type: 'Furniture', category: SURVEY_STRUCTURE_CATEGORY, labelFr: 'Poteau', labelEn: 'Column', iconKey: 'structure-column',
    defaults: { width: 0.3, depth: 0.3, height: 2.5 }, structure: { type: 'Column', shape: 'rect' } },
  { id: 'structure-column-round', type: 'Furniture', category: SURVEY_STRUCTURE_CATEGORY, labelFr: 'Poteau rond', labelEn: 'Round column', iconKey: 'structure-column-round',
    defaults: { width: 0.3, depth: 0.3, height: 2.5 }, structure: { type: 'Column', shape: 'circle' } },
  { id: 'structure-chimney', type: 'Furniture', category: SURVEY_STRUCTURE_CATEGORY, labelFr: 'Conduit de cheminée', labelEn: 'Chimney flue', iconKey: 'structure-chimney',
    defaults: { width: 0.5, depth: 0.5, height: 2.5 }, structure: { type: 'Chimney', kind: 'flue' } },
  { id: 'structure-fireplace', type: 'Furniture', category: SURVEY_STRUCTURE_CATEGORY, labelFr: 'Cheminée (foyer)', labelEn: 'Fireplace', iconKey: 'structure-fireplace',
    defaults: { width: 1.2, depth: 0.6, height: 2.5 }, structure: { type: 'Chimney', kind: 'fireplace' } },
  { id: 'structure-stove', type: 'Furniture', category: SURVEY_STRUCTURE_CATEGORY, labelFr: 'Poêle', labelEn: 'Stove', iconKey: 'structure-stove',
    defaults: { width: 0.5, depth: 0.45, height: 2.5 }, structure: { type: 'Chimney', kind: 'stove' } },
];

export const SURVEY_FURNITURE_MODELS: ElementDef[] = [...BUILTIN_CATALOGUE.filter(model => model.type === 'Furniture'), ...SURVEY_STRUCTURE_MODELS];

export interface SurveyFurniture {
  id: string;
  model: string;
  /** Centre in metres, in the same coordinate system as the drawn room. */
  center: [number, number];
  width_m: number;
  depth_m: number;
  height_m: number;
  rotation: number;
}

/** Plan axes follow the room's first wall, starting at the lower-left corner of its aligned bounds. */
export function furniturePlanFrame(room: SurveyRoom) {
  const wall = room.walls[0];
  const [a, b] = [room.polygon[wall.from], room.polygon[wall.to]];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
  const project = ([x, y]: [number, number]): [number, number] => [x * ux + y * uy, y * ux - x * uy];
  const corners = room.polygon.map(project);
  const left = Math.min(...corners.map(p => p[0])), bottom = Math.min(...corners.map(p => p[1]));
  return {
    toPlan: (p: [number, number]): [number, number] => {
      const [x, y] = project(p);
      return [x - left, y - bottom];
    },
    fromPlan: ([x, y]: [number, number]): [number, number] => [
      (x + left) * ux - (y + bottom) * uy,
      (x + left) * uy + (y + bottom) * ux,
    ],
  };
}

export interface SurveyRoom {
  id: string;
  name: string;
  /** Inner face polygon in the room's local frame, metres, counter-clockwise. */
  polygon: [number, number][];
  walls: SurveyWall[];
  geometryStatus: GeometryStatus;
  /** How the room was drawn: a rectangle keeps the right-angle hypothesis; absent means rectangle when it has 4 vertices. */
  shape?: 'rectangle' | 'polygon';
  ceilingHeight_m?: number;
  openings?: SurveyOpening[];
  technicalPoints?: SurveyTechnicalPoint[];
  furniture?: SurveyFurniture[];
  /** Control measurements (spec F-05, ADR 0009): what the solver needs to resolve the shape. */
  diagonals?: SurveyDiagonal[];
  angles?: SurveyAngle[];
  photos?: SurveyPhoto[];
  /** Frozen room: refused by every edit until it is unfrozen, so it is not changed by mistake. */
  frozen?: boolean;
}

/** Surface a photo documents: a wall face of the room, its floor or its ceiling. */
export type SurveySurface = { kind: 'wall'; wallId: string } | { kind: 'floor' } | { kind: 'ceiling' };

/**
 * Photo of a surface (ADR 0010). The image travels in the archive at `file`, re-encoded as JPEG
 * (2048 px at most, without EXIF metadata); the survey only references it.
 */
export interface SurveyPhoto {
  id: string;
  surface: SurveySurface;
  file: string;
  width: number;
  height: number;
  takenAt: string;
  annotations?: PhotoAnnotation[];
}

/**
 * Annotation on a photo (spec F-21, F-23). Positions are relative to the image, 0–1 on each
 * axis, so they survive any display size.
 */
export interface PhotoNote {
  id: string;
  type: 'note';
  /** Centre of the post-it. */
  p: [number, number];
  /** Width and height, as fractions of the image; absent on post-its sized to their text. */
  size?: [number, number];
  /** Display as a post-it icon when true. Older notes open at their full size. */
  collapsed?: boolean;
  text: string;
  createdAt: string;
}
/**
 * Photo cote (spec F-22, F-24): two anchor points and a value typed on site. The photo is not
 * calibrated; the value is never derived from the pixels.
 */
export interface PhotoMeasure {
  id: string;
  type: 'measure';
  p1: [number, number];
  p2: [number, number];
  value_m: number;
  source: MeasureSource;
  createdAt: string;
}
export type PhotoAnnotation = PhotoNote | PhotoMeasure;

export const PHOTO_FILE = /^photos\/[A-Za-z0-9_-]+\.jpg$/;
export const PHOTO_MAX_SIDE = 2048;

/** Measured distance between two non-adjacent vertices of the inner-face polygon. */
export interface SurveyDiagonal {
  id: string;
  from: number;
  to: number;
  length_m: number;
  source: MeasureSource;
}

/** Measured interior angle at a vertex, in degrees. */
export interface SurveyAngle {
  id: string;
  vertex: number;
  deg: number;
}

export interface SurveyLevel {
  id: string;
  name: string;
  rooms: SurveyRoom[];
  /** Reference room (ADR 0012): origin and orientation of the plan; the first room when absent. */
  referenceRoomId?: string;
}

export interface Survey {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  levels: SurveyLevel[];
  /** Survey properties: default values used where nothing was measured. */
  defaults?: SurveyDefaults;
}

export interface SurveyDefaults {
  ceilingHeight_m?: number;
  /** Estimated thickness of a wall linked to another room (partition). */
  interiorThickness_m?: number;
  /** Estimated thickness of a wall not linked to another room. */
  exteriorThickness_m?: number;
}

/** The survey's default values, with the built-in ones where none was chosen. */
export function surveyDefaults(survey: Pick<Survey, 'defaults'>): Required<SurveyDefaults> {
  return { ceilingHeight_m: 2.5, interiorThickness_m: 0.2, exteriorThickness_m: 0.2, ...survey.defaults };
}

export interface SurveyWarning {
  roomId: string;
  wallIds: string[];
  message: string;
}

interface Manifest {
  format: typeof SURVEY_FORMAT;
  formatVersion: number;
  appVersion: string;
}

/** MIGRATIONS[n] upgrades version n survey content to n + 1. Never edit a shipped entry. */
const MIGRATIONS: Record<number, (survey: unknown) => unknown> = {
  // v1 → v2: every new field is optional; the room shape, implicit in v1, becomes explicit.
  1: survey => {
    const s = survey as { levels?: { rooms?: { polygon?: unknown[]; shape?: string }[] }[] };
    for (const level of s.levels ?? []) for (const room of level.rooms ?? []) {
      if (room.shape === undefined && Array.isArray(room.polygon)) room.shape = room.polygon.length === 4 ? 'rectangle' : 'polygon';
    }
    return s;
  },
  // v2 → v3: only a new door operation value; older content is unchanged.
  2: survey => survey,
  // v3 → v4: offsets of existing links were never measured explicitly.
  3: survey => {
    const s = survey as { levels?: { rooms?: { walls?: { shared?: { offsetStatus?: string } }[] }[] }[] };
    for (const level of s.levels ?? []) for (const room of level.rooms ?? []) for (const wall of room.walls ?? [])
      if (wall.shared && wall.shared.offsetStatus === undefined) wall.shared.offsetStatus = 'estimated';
    return s;
  },
  // v4 → v5: a face may have several links; the single link becomes a one-element list.
  4: survey => {
    const s = survey as { levels?: { rooms?: { walls?: { shared?: unknown; links?: unknown[] }[] }[] }[] };
    for (const level of s.levels ?? []) for (const room of level.rooms ?? []) for (const wall of room.walls ?? []) {
      if (wall.shared) wall.links = [wall.shared];
      delete wall.shared;
    }
    return s;
  },
  // v5 → v6: only a new optional field (aligned faces).
  5: survey => survey,
  // v6 → v7: rooms may carry technical points.
  6: survey => survey,
  // v7 → v8: rooms may carry furniture.
  7: survey => survey,
  // v8 → v9: furniture entries may use a structure model (column, chimney).
  8: survey => survey,
};

/** Brings survey content saved by an older version up to date (files, or the app's local storage). */
export function migrateSurvey(survey: unknown, fromVersion: number): unknown {
  if (fromVersion > SURVEY_FORMAT_VERSION) throw new SurveyFileError(tr(`Ce relevé a été créé avec une version plus récente de l'application Survey (format ${fromVersion}). Mettez skAItch à jour pour l'ouvrir.`, `This survey was made with a newer version of the Survey app (format ${fromVersion}). Update skAItch to open it.`));
  let v = fromVersion, s = structuredClone(survey);
  while (v < SURVEY_FORMAT_VERSION) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new SurveyFileError(tr(`Format de relevé ${v} non pris en charge.`, `Survey format ${v} is not supported.`));
    s = migrate(s);
    v++;
  }
  return s;
}

export class SurveyFileError extends Error {}

const SOURCES: MeasureSource[] = ['laser', 'tape', 'manual', 'estimated', 'computed'];

function fail(message: string): never { throw new SurveyFileError(message); }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validSurveyFurniture(v: unknown): v is SurveyFurniture {
  return isObj(v) && isStr(v.id) && SURVEY_FURNITURE_MODELS.some(model => model.id === v.model)
    && Array.isArray(v.center) && v.center.length === 2 && isNum(v.center[0]) && isNum(v.center[1])
    && isNum(v.width_m) && v.width_m > 0 && isNum(v.depth_m) && v.depth_m > 0
    && isNum(v.height_m) && v.height_m > 0 && isNum(v.rotation);
}

/** Room drawn as a rectangle whose shape still relies on the right-angle hypothesis. */
export const isAssumedRectangle = (room: SurveyRoom) =>
  room.geometryStatus === 'assumed' && room.polygon.length === 4 && room.shape !== 'polygon';

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** True when no two non-adjacent edges of the closed polygon cross. */
export function isSimplePolygon(polygon: [number, number][]) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) return false;
  }
  return true;
}

export function signedArea(polygon: [number, number][]) {
  let a = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function validateRoom(room: unknown, where: string): asserts room is SurveyRoom {
  if (!isObj(room) || !isStr(room.id) || typeof room.name !== 'string') fail(tr(`${where} : identifiant ou nom manquant.`, `${where}: missing identifier or name.`));
  const at = tr(`${where} « ${room.name || room.id} »`, `${where} “${room.name || room.id}”`);
  const polygon = room.polygon;
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every(p => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])))
    fail(tr(`${at} : le contour doit compter au moins 3 sommets [x, y] en mètres.`, `${at}: the outline needs at least 3 corners [x, y] in metres.`));
  if (signedArea(polygon as [number, number][]) <= 0) fail(tr(`${at} : le contour doit être fermé et orienté dans le sens antihoraire.`, `${at}: the outline must be closed and counter-clockwise.`));
  if (!isSimplePolygon(polygon as [number, number][])) fail(`${at} : le contour se recoupe.`);
  if (room.shape !== undefined && room.shape !== 'rectangle' && room.shape !== 'polygon') fail(`${at} : forme inconnue.`);
  if (room.geometryStatus !== 'assumed' && room.geometryStatus !== 'resolved') fail(tr(`${at} : statut de géométrie inconnu.`, `${at}: unknown geometry status.`));
  if (room.frozen !== undefined && typeof room.frozen !== 'boolean') fail(tr(`${at} : état figé invalide.`, `${at}: invalid frozen state.`));
  if (room.ceilingHeight_m !== undefined && !(isNum(room.ceilingHeight_m) && room.ceilingHeight_m > 0)) fail(`${at} : hauteur sous plafond invalide.`);
  if (!Array.isArray(room.walls)) fail(tr(`${at} : liste des murs manquante.`, `${at}: wall list missing.`));
  const n = polygon.length;
  const ids = new Set<string>();
  for (const wall of room.walls as unknown[]) {
    if (!isObj(wall) || !isStr(wall.id)) fail(tr(`${at} : mur sans identifiant.`, `${at}: wall without identifier.`));
    if (ids.has(wall.id)) fail(tr(`${at} : identifiant de mur en double « ${wall.id} ».`, `${at}: duplicate wall identifier “${wall.id}”.`));
    ids.add(wall.id);
    const w = tr(`${at}, mur « ${wall.id} »`, `${at}, wall “${wall.id}”`);
    if (!Number.isInteger(wall.from) || !Number.isInteger(wall.to) || (wall.from as number) < 0 || (wall.from as number) >= n || wall.to !== ((wall.from as number) + 1) % n)
      fail(tr(`${w} : il doit relier deux sommets consécutifs du contour.`, `${w}: it must link two consecutive corners of the outline.`));
    if (!isNum(wall.length_m) || wall.length_m <= 0) fail(`${w} : longueur invalide.`);
    if (!SOURCES.includes(wall.source as MeasureSource)) fail(`${w} : origine de mesure inconnue.`);
    if (typeof wall.locked !== 'boolean') fail(`${w} : verrouillage manquant.`);
    if (!isNum(wall.thickness_m) || wall.thickness_m <= 0) fail(tr(`${w} : épaisseur invalide.`, `${w}: invalid thickness.`));
    if (wall.thicknessStatus !== 'measured' && wall.thicknessStatus !== 'estimated') fail(tr(`${w} : statut d'épaisseur inconnu.`, `${w}: unknown thickness status.`));
    if (wall.name !== undefined && typeof wall.name !== 'string') fail(tr(`${w} : nom invalide.`, `${w}: invalid name.`));
    const badLink = (l: unknown) => !isObj(l) || !isStr(l.roomId) || !isStr(l.wallId) || !isNum(l.offset_m)
      || (l.offsetStatus !== undefined && l.offsetStatus !== 'measured' && l.offsetStatus !== 'estimated');
    if (wall.links !== undefined && (!Array.isArray(wall.links) || wall.links.some(badLink)))
      fail(`${w} : lien de faces invalide.`);
    const badAlignment = (l: unknown) => !isObj(l) || !isStr(l.roomId) || !isStr(l.wallId) || !isNum(l.step_m)
      || (l.stepStatus !== undefined && l.stepStatus !== 'measured' && l.stepStatus !== 'estimated');
    if (wall.alignments !== undefined && (!Array.isArray(wall.alignments) || wall.alignments.some(badAlignment)))
      fail(tr(`${w} : alignement invalide.`, `${w}: invalid alignment.`));
  }
  if (ids.size !== n) fail(tr(`${at} : chaque côté du contour doit porter exactement un mur.`, `${at}: each side of the outline must carry exactly one wall.`));
  for (const d of (room.diagonals ?? []) as unknown[]) {
    if (!isObj(d) || !isStr(d.id) || !Number.isInteger(d.from) || !Number.isInteger(d.to)) fail(`${at} : diagonale invalide.`);
    const [i, j] = [d.from as number, d.to as number];
    const adjacent = (j - i + n) % n === 1 || (i - j + n) % n === 1;
    if (i < 0 || j < 0 || i >= n || j >= n || i === j || adjacent) fail(tr(`${at} : une diagonale relie deux sommets non voisins.`, `${at}: a diagonal links two corners that are not neighbours.`));
    if (!isNum(d.length_m) || d.length_m <= 0) fail(`${at} : longueur de diagonale invalide.`);
    if (!SOURCES.includes(d.source as MeasureSource)) fail(`${at} : origine de diagonale inconnue.`);
  }
  for (const a of (room.angles ?? []) as unknown[]) {
    if (!isObj(a) || !isStr(a.id) || !Number.isInteger(a.vertex) || (a.vertex as number) < 0 || (a.vertex as number) >= n) fail(`${at} : angle invalide.`);
    if (!isNum(a.deg) || a.deg <= 0 || a.deg >= 360) fail(tr(`${at} : un angle est compris entre 0 et 360°.`, `${at}: an angle lies between 0 and 360°.`));
  }
  for (const ph of (room.photos ?? []) as unknown[]) {
    if (!isObj(ph) || !isStr(ph.id) || !isStr(ph.file) || !PHOTO_FILE.test(ph.file)) fail(`${at} : photo invalide.`);
    const sf = ph.surface;
    const okSurface = isObj(sf) && (sf.kind === 'floor' || sf.kind === 'ceiling' || (sf.kind === 'wall' && (room.walls as SurveyWall[]).some(w => w.id === sf.wallId)));
    if (!okSurface) fail(tr(`${at} : photo « ${ph.id} » rattachée à une surface inconnue.`, `${at}: photo “${ph.id}” attached to an unknown surface.`));
    if (!isNum(ph.width) || !isNum(ph.height) || ph.width <= 0 || ph.height <= 0) fail(`${at} : dimensions de photo invalides.`);
    const inImage = (q: unknown) => Array.isArray(q) && q.length === 2 && q.every(v => isNum(v) && v >= 0 && v <= 1);
    for (const an of (ph.annotations ?? []) as unknown[]) {
      const note = isObj(an) && an.type === 'note' && inImage(an.p) && typeof an.text === 'string'
        && (an.collapsed === undefined || typeof an.collapsed === 'boolean')
        && (an.size === undefined || (Array.isArray(an.size) && an.size.length === 2 && an.size.every(v => typeof v === 'number' && v > 0 && v <= 1)));
      const measure = isObj(an) && an.type === 'measure' && inImage(an.p1) && inImage(an.p2) && isNum(an.value_m) && an.value_m > 0 && SOURCES.includes(an.source as MeasureSource);
      if (!isObj(an) || !isStr(an.id) || !(note || measure)) fail(tr(`${at} : annotation invalide sur la photo « ${ph.id} ».`, `${at}: invalid annotation on photo “${ph.id}”.`));
    }
  }
  if (room.technicalPoints !== undefined) {
    const pointIds = new Set<string>();
    if (!Array.isArray(room.technicalPoints)) fail(tr(`${at} : liste des points techniques invalide.`, `${at}: invalid technical point list.`));
    for (const point of room.technicalPoints as unknown[]) {
      if (!isObj(point) || !isStr(point.id) || pointIds.has(point.id) || !isStr(point.wallId) || !ids.has(point.wallId)
        || !TECHNICAL_CATALOGUE.some(model => model.id === point.model) || (point.edge !== 'left' && point.edge !== 'right')
        || !isNum(point.distance_m) || point.distance_m < 0 || !isNum(point.height_m) || point.height_m < 0
        || (point.distanceMeasured !== undefined && point.distanceMeasured !== true) || (point.heightMeasured !== undefined && point.heightMeasured !== true))
        fail(tr(`${at} : point technique invalide.`, `${at}: invalid technical point.`));
      pointIds.add(point.id);
    }
  }
  if (room.furniture !== undefined) {
    const furnitureIds = new Set<string>();
    if (!Array.isArray(room.furniture)) fail(tr(`${at} : liste des meubles invalide.`, `${at}: invalid furniture list.`));
    for (const entry of room.furniture) {
      if (!validSurveyFurniture(entry) || furnitureIds.has(entry.id)) fail(tr(`${at} : meuble invalide.`, `${at}: invalid furniture.`));
      furnitureIds.add(entry.id);
    }
  }
  if (room.openings === undefined) return;
  if (!Array.isArray(room.openings)) fail(tr(`${at} : liste des ouvertures invalide.`, `${at}: invalid opening list.`));
  const walls = room.walls as SurveyWall[];
  const openingIds = new Set<string>();
  for (const o of room.openings as unknown[]) {
    if (!isObj(o) || !isStr(o.id)) fail(tr(`${at} : ouverture sans identifiant.`, `${at}: opening without identifier.`));
    if (openingIds.has(o.id)) fail(tr(`${at} : identifiant d'ouverture en double « ${o.id} ».`, `${at}: duplicate opening identifier “${o.id}”.`));
    openingIds.add(o.id);
    const w = tr(`${at}, ouverture « ${o.id} »`, `${at}, opening “${o.id}”`);
    const wall = walls.find(x => x.id === o.wallId);
    if (!wall) fail(tr(`${w} : mur porteur introuvable.`, `${w}: host wall not found.`));
    if (o.kind !== 'door' && o.kind !== 'window') fail(`${w} : type inconnu.`);
    if (!OPENING_OPERATIONS[o.kind].includes(o.operation as OpeningOperation)) fail(tr(`${w} : mécanisme « ${String(o.operation)} » impossible pour ce type.`, `${w}: mechanism “${String(o.operation)}” is not possible for this type.`));
    if (!isNum(o.width_m) || o.width_m <= 0) fail(`${w} : largeur invalide.`);
    if (!isNum(o.height_m) || o.height_m <= 0) fail(`${w} : hauteur invalide.`);
    if (!isNum(o.offset_m) || o.offset_m < 0) fail(`${w} : distance avant invalide.`);
    if (o.sill_m !== undefined && !(isNum(o.sill_m) && o.sill_m >= 0)) fail(tr(`${w} : allège invalide.`, `${w}: invalid sill.`));
    if (o.hinge !== 'start' && o.hinge !== 'end') fail(tr(`${w} : côté de charnière inconnu.`, `${w}: unknown hinge side.`));
    if (o.swing !== 'in' && o.swing !== 'out') fail(`${w} : sens d'ouverture inconnu.`);
  }
}

/**
 * Opening rules (spec 5.4): strictly positive width, within the host wall, no overlap.
 * Returns a user-facing message, or null when the openings of the room are valid.
 */
export function openingProblem(room: SurveyRoom): string | null {
  for (const o of room.openings ?? []) {
    const wall = room.walls.find(w => w.id === o.wallId)!;
    if (o.offset_m + o.width_m > wall.length_m + 1e-9) return tr(`L'ouverture dépasse le mur (${(o.offset_m + o.width_m).toFixed(2)} m sur ${wall.length_m.toFixed(2)} m).`, `The opening goes past the wall (${(o.offset_m + o.width_m).toFixed(2)} m on ${wall.length_m.toFixed(2)} m).`);
    for (const other of room.openings ?? []) {
      if (other === o || other.wallId !== o.wallId) continue;
      if (o.offset_m < other.offset_m + other.width_m - 1e-9 && other.offset_m < o.offset_m + o.width_m - 1e-9) return tr('Deux ouvertures se chevauchent sur le même mur.', 'Two openings overlap on the same wall.');
    }
  }
  return null;
}

/** Validates parsed survey content; throws SurveyFileError with a user-facing message. */
export function validateSurvey(survey: unknown): asserts survey is Survey {
  if (!isObj(survey) || !isStr(survey.id)) fail(tr('Relevé invalide : identifiant manquant.', 'Invalid survey: missing identifier.'));
  if (!Array.isArray(survey.levels) || survey.levels.length === 0) fail(tr('Relevé invalide : aucun niveau.', 'Invalid survey: no level.'));
  if (survey.defaults !== undefined) {
    const d = survey.defaults;
    if (!isObj(d) || ['ceilingHeight_m', 'interiorThickness_m', 'exteriorThickness_m'].some(k => d[k] !== undefined && !(isNum(d[k]) && (d[k] as number) > 0)))
      fail(tr('Relevé invalide : valeurs par défaut incorrectes.', 'Invalid survey: wrong default values.'));
  }
  const roomIds = new Set<string>();
  for (const level of survey.levels as unknown[]) {
    if (!isObj(level) || !isStr(level.id) || typeof level.name !== 'string') fail(tr('Relevé invalide : niveau sans identifiant.', 'Invalid survey: level without identifier.'));
    if (!Array.isArray(level.rooms)) fail(tr(`Niveau « ${level.name} » : liste des pièces manquante.`, `Level “${level.name}”: room list missing.`));
    if (level.referenceRoomId !== undefined && !isStr(level.referenceRoomId)) fail(tr(`Niveau « ${level.name} » : pièce de référence invalide.`, `Level “${level.name}”: invalid reference room.`));
    for (const room of level.rooms as unknown[]) {
      validateRoom(room, tr(`Niveau « ${level.name} », pièce`, `Level “${level.name}”, room`));
      const problem = openingProblem(room);
      if (problem) fail(tr(`Pièce « ${room.name} » : ${problem}`, `Room “${room.name}”: ${problem}`));
      if (roomIds.has(room.id)) fail(tr(`Identifiant de pièce en double « ${room.id} ».`, `Duplicate room identifier “${room.id}”.`));
      roomIds.add(room.id);
    }
    // linked faces: each link points at a face of the same level that points back.
    const rooms = level.rooms as SurveyRoom[];
    for (const room of rooms) for (const wall of room.walls) {
      const seen = new Set<string>();
      for (const link of wallLinks(wall)) {
        const other = rooms.find(r => r.id === link.roomId)?.walls.find(w => w.id === link.wallId);
        if (!other || !wallLinks(other).some(b => b.roomId === room.id && b.wallId === wall.id))
          fail(tr(`Pièce « ${room.name} », mur « ${wall.id} » : la face liée est introuvable ou ne pointe pas en retour.`, `Room “${room.name}”, wall “${wall.id}”: the linked face is missing or does not point back.`));
        if (other === wall) fail(tr(`Pièce « ${room.name} » : un mur ne peut pas être lié à lui-même.`, `Room “${room.name}”: a wall cannot be linked to itself.`));
        const key = `${link.roomId}/${link.wallId}`;
        if (seen.has(key)) fail(tr(`Pièce « ${room.name} », mur « ${wall.id} » : lien en double.`, `Room “${room.name}”, wall “${wall.id}”: duplicate link.`));
        seen.add(key);
      }
    }
  }
}

/**
 * The links of a face. Survey levels kept in project files before format 5 carry a single
 * `shared` link: it is read as a one-element list.
 */
export function wallLinks(wall: SurveyWall): FaceLink[] {
  const legacy = (wall as { shared?: FaceLink }).shared;
  return wall.links ?? (legacy ? [legacy] : []);
}

export const isLinked = (wall: SurveyWall) => wallLinks(wall).length > 0;

/** A linked face seen from a face: the other room and face, the link and its back link. */
export interface LinkedFace { room: SurveyRoom; wall: SurveyWall; link: FaceLink; back: FaceLink }

/** Every face linked to `wall`, with the link (on `wall`) and the back link (on the other face). */
export function linkedFaces(level: SurveyLevel, wall: SurveyWall): LinkedFace[] {
  const owner = level.rooms.find(r => r.walls.includes(wall));
  return wallLinks(wall).flatMap(link => {
    const room = level.rooms.find(r => r.id === link.roomId);
    const other = room?.walls.find(w => w.id === link.wallId);
    const back = other && wallLinks(other).find(b => b.wallId === wall.id && (!owner || b.roomId === owner.id));
    return room && other && back ? [{ room, wall: other, link, back }] : [];
  });
}

/**
 * The stretch of `wall` that a link covers, as [start, end] along it from its start. The other
 * face runs the opposite way. Each side's offset gives the stretch; a side derived from the other
 * may have been clamped at 0, which only moves its stretch further along: the lower one is right.
 */
export function linkStretch(wall: SurveyWall, f: Pick<LinkedFace, 'wall' | 'link' | 'back'>): [number, number] {
  const len = wall.length_m, other = f.wall.length_m;
  const lo = Math.min(f.link.offset_m, f.back.offset_m + len - other);
  const hi = Math.min(f.link.offset_m + other, f.back.offset_m + len);
  return [Math.max(0, lo), Math.min(len, hi)];
}

/** An aligned face seen from a face: the other room and face, the alignment and its back one. */
export interface AlignedFace { room: SurveyRoom; wall: SurveyWall; alignment: FaceAlignment; back: FaceAlignment }

/** Every face aligned with `wall` (continuing it on the same line). */
export function alignedFaces(level: SurveyLevel, wall: SurveyWall): AlignedFace[] {
  return (wall.alignments ?? []).flatMap(alignment => {
    const room = level.rooms.find(r => r.id === alignment.roomId);
    const other = room?.walls.find(w => w.id === alignment.wallId);
    const back = other?.alignments?.find(b => b.wallId === wall.id);
    return room && other && back ? [{ room, wall: other, alignment, back }] : [];
  });
}

/** Length of the stretch common to two linked faces. */
export function sharedLength(wall: SurveyWall, f: Pick<LinkedFace, 'wall' | 'link' | 'back'>) {
  const [a, b] = linkStretch(wall, f);
  return Math.max(0, b - a);
}

/**
 * Openings seen on a room's faces: its own, plus those of linked faces mapped into this face's
 * coordinates (spec F-15: one door, visible from both rooms). `owner` is the room that holds it.
 */
export function faceOpenings(level: SurveyLevel, room: SurveyRoom): { opening: SurveyOpening; owner: string; wallId: string; offset_m: number; hinge: 'start' | 'end'; swing: 'in' | 'out' }[] {
  const own = (room.openings ?? []).map(o => ({ opening: o, owner: room.id, wallId: o.wallId, offset_m: o.offset_m, hinge: o.hinge, swing: o.swing }));
  const seen = room.walls.flatMap(wall => linkedFaces(level, wall).flatMap(link => {
    return (link.room.openings ?? []).filter(o => o.wallId === link.wall.id).flatMap(o => {
      // The back link's offset is where this face ends along the other face, and the faces run
      // opposite: position s over there is (this length − (s − that offset)) here.
      const startHere = wall.length_m - (o.offset_m + o.width_m - link.back.offset_m);
      // Only the openings facing this face (another room may share the rest of that face).
      if (startHere < -0.01 || startHere + o.width_m > wall.length_m + 0.01) return [];
      return [{ opening: o, owner: link.room.id, wallId: wall.id, offset_m: startHere,
        hinge: o.hinge === 'start' ? 'end' as const : 'start' as const, swing: o.swing === 'in' ? 'out' as const : 'in' as const }];
    });
  }));
  return [...own, ...seen];
}

/** Overlap below which two openings on facing faces are not reported (jamb tolerance). */
const DUPLICATE_OVERLAP_M = 0.05;

export interface DuplicateOpening {
  /** Room and face holding `opening`. */
  roomId: string; wallId: string; opening: SurveyOpening;
  /** The opening entered in the other room, on the linked face, and where it falls on this face. */
  otherRoomId: string; other: SurveyOpening; otherOffset_m: number;
  overlap_m: number;
}

/**
 * Openings entered in both rooms of a shared wall (ADR 0008 wants a single object, seen through
 * the link): an own opening overlapping one seen from the linked face. Overlap, not equality, so
 * the same opening placed differently on each face is caught too, e.g. offsets measured from
 * opposite ends, or a rare opening not perpendicular to the wall. Each pair is reported once.
 */
export function duplicateOpenings(level: SurveyLevel, faces?: { roomId: string; wallId: string }[]): DuplicateOpening[] {
  const out: DuplicateOpening[] = [];
  for (const room of level.rooms) {
    const all = faceOpenings(level, room);
    for (const own of all.filter(o => o.owner === room.id)) {
      if (faces && !faces.some(f => f.roomId === room.id && f.wallId === own.wallId)) continue;
      for (const seen of all.filter(o => o.owner !== room.id && o.wallId === own.wallId && o.owner > room.id)) {
        const overlap = Math.min(own.offset_m + own.opening.width_m, seen.offset_m + seen.opening.width_m) - Math.max(own.offset_m, seen.offset_m);
        if (overlap >= DUPLICATE_OVERLAP_M) out.push({ roomId: room.id, wallId: own.wallId, opening: own.opening, otherRoomId: seen.owner, other: seen.opening, otherOffset_m: seen.offset_m, overlap_m: overlap });
      }
    }
  }
  return out;
}

const TOLERANCE_M = 0.005;

/**
 * Inconsistencies that are reported, never corrected: a wall length that disagrees with the
 * drawn polygon, e.g. the two opposite sides of an assumed rectangle measured 4.32 and 4.30.
 */
export function surveyWarnings(survey: Survey, tolerance = TOLERANCE_M): SurveyWarning[] {
  const warnings: SurveyWarning[] = [];
  for (const level of survey.levels) for (const room of level.rooms) {
    // Contradictory measurements (spec AT-08): reported with every measure involved, nothing changed.
    const solved = solveRoom(room, tolerance === TOLERANCE_M ? DEFAULT_TOLERANCE_M : tolerance);
    if (solved.status === 'inconsistent') warnings.push({ roomId: room.id, wallIds: solved.conflicting.map(m => m.id), message: `${room.name} : ${solved.message}` });
    for (const wall of room.walls) {
      const [x1, y1] = room.polygon[wall.from];
      const [x2, y2] = room.polygon[wall.to];
      const drawn = Math.hypot(x2 - x1, y2 - y1);
      for (const link of linkedFaces(level, wall)) if (Math.abs(link.wall.thickness_m - wall.thickness_m) > 1e-9 && room.id < link.room.id)
        warnings.push({ roomId: room.id, wallIds: [wall.id, link.wall.id], message: tr(`${room.name} : les deux faces d'un mur partagé ont des épaisseurs différentes.`, `${room.name}: the two faces of a shared wall have different thicknesses.`) });
      if (Math.abs(drawn - wall.length_m) > tolerance) {
        const opposite = isAssumedRectangle(room) ? room.walls.find(o => o.from === (wall.from + 2) % 4) : undefined;
        warnings.push({
          roomId: room.id,
          wallIds: opposite ? [wall.id, opposite.id] : [wall.id],
          message: opposite
            ? tr(`${room.name} : murs opposés ${wall.length_m.toFixed(3)} m et ${opposite.length_m.toFixed(3)} m, le rectangle supposé ne peut pas respecter les deux.`, `${room.name}: opposite walls ${wall.length_m.toFixed(3)} m and ${opposite.length_m.toFixed(3)} m, the assumed rectangle cannot match both.`)
            : tr(`${room.name} : le mur mesure ${wall.length_m.toFixed(3)} m mais le contour dessiné ${drawn.toFixed(3)} m.`, `${room.name}: the wall measures ${wall.length_m.toFixed(3)} m but the drawn outline ${drawn.toFixed(3)} m.`),
        });
      }
    }
  }
  // The same opening entered from both rooms of a shared wall: reconstruction would cut both.
  for (const level of survey.levels) for (const d of duplicateOpenings(level)) {
    const room = level.rooms.find(r => r.id === d.roomId)!, other = level.rooms.find(r => r.id === d.otherRoomId)!;
    const otherWall = other.walls.find(w => w.id === d.other.wallId)!;
    const [a, b] = [d.opening.offset_m, d.otherOffset_m].map(x => x.toFixed(2));
    warnings.push({
      roomId: room.id,
      wallIds: [d.wallId, otherWall.id],
      message: tr(
        `${room.name} / ${other.name} : la même ouverture semble saisie dans les deux pièces (à ${a} m ici, à ${b} m vue depuis ${other.name}). Le mur partagé n'en porte qu'une : supprimez l'autre. Si l'ouverture est biaise, gardez celle dont la position est mesurée.`,
        `${room.name} / ${other.name}: the same opening seems entered in both rooms (at ${a} m here, at ${b} m seen from ${other.name}). The shared wall holds only one: delete the other. If the opening is skewed, keep the one whose position is measured.`,
      ),
    });
  }
  // An opposite-walls warning is reported once per pair.
  const seen = new Set<string>();
  return warnings.filter(w => { const k = [...w.wallIds].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Every photo file a survey references. */
export const surveyPhotoFiles = (survey: Survey) => survey.levels.flatMap(l => l.rooms.flatMap(r => (r.photos ?? []).map(p => p.file)));

/** Writes the archive; `photos` holds the JPEG bytes of every referenced photo, by file path. */
export function writeSurveyFile(survey: Survey, appVersion: string, photos: Record<string, Uint8Array> = {}): Uint8Array {
  validateSurvey(survey);
  const manifest: Manifest = { format: SURVEY_FORMAT, formatVersion: SURVEY_FORMAT_VERSION, appVersion };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'survey.json': strToU8(JSON.stringify(survey)),
  };
  for (const file of surveyPhotoFiles(survey)) {
    if (!photos[file]) throw new SurveyFileError(`Photo manquante : ${file}.`);
    // Already compressed: stored, not deflated again.
    files[file] = photos[file];
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, k.endsWith('.jpg') ? [v, { level: 0 }] : v])) as never);
}

export function readSurveyFile(bytes: Uint8Array): Survey {
  return readSurveyArchive(bytes).survey;
}

/** Reads the survey and its photos (JPEG bytes by file path). */
export function readSurveyArchive(bytes: Uint8Array): { survey: Survey; photos: Record<string, Uint8Array> } {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        total += f.originalSize;
        if (total > MAX_UNPACKED_BYTES) throw new SurveyFileError(tr('Fichier relevé trop volumineux.', 'Survey file too large.'));
        return f.name === 'manifest.json' || f.name === 'survey.json' || PHOTO_FILE.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof SurveyFileError) throw e;
    fail(tr("Ce fichier n'est pas un fichier relevé lisible.", 'This file is not a readable survey file.'));
  }
  let manifest: unknown, survey: unknown;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
    survey = JSON.parse(strFromU8(files['survey.json']));
  } catch {
    fail(tr("Ce fichier n'est pas un fichier relevé lisible.", 'This file is not a readable survey file.'));
  }
  if (!isObj(manifest) || manifest.format !== SURVEY_FORMAT || !Number.isInteger(manifest.formatVersion))
    fail(tr("Ce fichier n'est pas un fichier relevé skAItch.", 'This file is not a skAItch survey file.'));
  survey = migrateSurvey(survey, manifest.formatVersion as number);
  validateSurvey(survey);
  const photos: Record<string, Uint8Array> = {};
  for (const file of surveyPhotoFiles(survey)) {
    if (!files[file]) fail(tr(`Ce relevé référence une photo absente de l'archive (${file}).`, `This survey refers to a photo missing from the archive (${file}).`));
    photos[file] = files[file];
  }
  return { survey, photos };
}

/** The survey attached to a storey: the associated survey level plus where it came from. */
export interface StoreySurvey {
  surveyId: string;
  surveyName: string;
  importedAt: string;
  level: SurveyLevel;
  /** The survey's default values (ceiling height…), when it set any. */
  defaults?: SurveyDefaults;
  /** Reduced copies of the level's photos (data URLs, 1024 px at most), by photo id. */
  photos?: Record<string, string>;
}

export function pointInPolygon([x, y]: [number, number], polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Where to write a room's name: the interior point farthest from its walls (approximate
 * pole of inaccessibility), so it stays inside L-shaped or concave rooms.
 */
export function roomLabelPoint(polygon: [number, number][]): [number, number] {
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const distToEdges = ([x, y]: [number, number]) => {
    let d = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
      d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
    }
    return d;
  };
  let best: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2], bestD = pointInPolygon(best, polygon) ? distToEdges(best) : -1;
  const steps = 24;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) {
    const p: [number, number] = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
    if (!pointInPolygon(p, polygon)) continue;
    const d = distToEdges(p);
    // Prefer the bounding-box centre on ties so rectangles keep a centred label.
    if (d > bestD + 1e-9) { best = p; bestD = d; }
  }
  return best;
}
