import { createStore, del, delMany, entries, get, keys, set } from 'idb-keyval';
import { migrateSurvey, SURVEY_FORMAT_VERSION, type Survey } from '@skaitch/core/survey/surveyFile';

/** Local, offline storage of surveys (IndexedDB inside the web view; survives app restarts). */
const store = createStore('skaitch-survey', 'surveys');
/** Photo bytes (re-encoded JPEG), apart from the surveys, keyed `surveyId/photoId` (ADR 0010). */
const photoStore = createStore('skaitch-survey-photos', 'photos');
/** Ids of archived surveys: hidden from the list, kept on the device until deleted from the archives. */
const archiveStore = createStore('skaitch-survey-archive', 'archived');

/** Surveys are stored with the format version they were saved in, and migrated when read. */
type Stored = { formatVersion: number; survey: Survey } | Survey;

export async function listSurveys(): Promise<Survey[]> {
  const all = await entries<string, Stored>(store);
  return all.map(([, v]) => ('formatVersion' in v
    ? migrateSurvey(v.survey, v.formatVersion)
    // Saved before versions were recorded: format 1.
    : migrateSurvey(v, 1)) as Survey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export const saveSurvey = (survey: Survey) => set(survey.id, { formatVersion: SURVEY_FORMAT_VERSION, survey } satisfies Stored, store);

const lastRoomKey = (surveyId: string) => `skaitch-survey:last-room:${surveyId}`;
export function loadLastRoom(surveyId: string): string | null {
  try { return localStorage.getItem(lastRoomKey(surveyId)); } catch { return null; }
}

export function rememberRoom(surveyId: string, roomId: string | null) {
  try {
    if (roomId === null) localStorage.removeItem(lastRoomKey(surveyId));
    else localStorage.setItem(lastRoomKey(surveyId), roomId);
  } catch { /* local storage is unavailable */ }
}

/** Element types locked on the plan (walls, openings, furniture), remembered per survey on this device. */
export type PlanLocks = { walls?: boolean; openings?: boolean; furniture?: boolean };
const locksKey = (surveyId: string) => `skaitch-survey:locks:${surveyId}`;
export function loadLocks(surveyId: string): PlanLocks {
  try { return JSON.parse(localStorage.getItem(locksKey(surveyId)) ?? '{}') as PlanLocks; } catch { return {}; }
}
export function saveLocks(surveyId: string, locks: PlanLocks) {
  try {
    if (Object.values(locks).some(Boolean)) localStorage.setItem(locksKey(surveyId), JSON.stringify(locks));
    else localStorage.removeItem(locksKey(surveyId));
  } catch { /* local storage is unavailable */ }
}

/** Deleting a survey deletes its photos too. */
export async function deleteSurvey(id: string) {
  const photoKeys = (await keys<string>(photoStore)).filter(k => k.startsWith(`${id}/`));
  await delMany(photoKeys, photoStore);
  await del(id, store);
  await del(id, archiveStore);
  await del(id, avatarStore);
  rememberRoom(id, null);
}

export const savePhoto = (surveyId: string, photoId: string, jpeg: Blob) => set(`${surveyId}/${photoId}`, jpeg, photoStore);
export const loadPhoto = (surveyId: string, photoId: string) => get<Blob>(`${surveyId}/${photoId}`, photoStore);
/**
 * Deletes the bytes of photos the survey no longer references. Run when leaving a survey, so
 * undo can still bring a photo back while editing, yet a deleted photo does not stay on the device.
 */
export async function purgeUnusedPhotos(survey: Survey) {
  const used = new Set(survey.levels.flatMap(l => l.rooms.flatMap(r => (r.photos ?? []).map(p => `${survey.id}/${p.id}`))));
  const unused = (await keys<string>(photoStore)).filter(k => k.startsWith(`${survey.id}/`) && !used.has(k));
  await delMany(unused, photoStore);
}

/** Survey avatar (small re-encoded JPEG), kept on the device apart from the survey file. */
const avatarStore = createStore('skaitch-survey-avatar', 'avatars');
/** A photo, or the name of one of the preset icons. */
export type Avatar = Blob | { icon: string };
export const saveAvatar = (id: string, avatar: Avatar) => set(id, avatar, avatarStore);
export const loadAvatar = (id: string) => get<Avatar>(id, avatarStore);
export const deleteAvatar = (id: string) => del(id, avatarStore);
export const listArchivedIds = async () => new Set(await keys<string>(archiveStore));
export const archiveSurvey = (id: string) => set(id, true, archiveStore);
export const unarchiveSurvey = (id: string) => del(id, archiveStore);
