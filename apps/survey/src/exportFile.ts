import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { loadPhoto } from './storage';
import { SURVEY_EXTENSION, SURVEY_MIME, writeSurveyFile, type Survey } from '@skaitch/core/survey/surveyFile';

export const APP_VERSION = '0.10.0';

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fileName(survey: Survey) {
  const slug = survey.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'releve';
  return `${slug}${SURVEY_EXTENSION}`;
}

/** The survey file of a survey, photos included (ADR 0010): what is exported and what is sent. */
export async function buildSurveyFile(survey: Survey): Promise<Uint8Array> {
  // Photos stored apart are packed into the archive.
  const photos: Record<string, Uint8Array> = {};
  for (const room of survey.levels.flatMap(l => l.rooms)) for (const p of room.photos ?? []) {
    const blob = await loadPhoto(survey.id, p.id);
    if (!blob) throw new Error(`Photo introuvable sur l'appareil : ${p.file}.`);
    photos[p.file] = new Uint8Array(await blob.arrayBuffer());
  }
  return writeSurveyFile(survey, APP_VERSION, photos);
}

/** Exports the survey file: share sheet on a phone, download in a browser. */
export async function exportSurvey(survey: Survey): Promise<void> {
  const bytes = await buildSurveyFile(survey);
  const name = fileName(survey);
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: name, data: bytesToBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: survey.name, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: SURVEY_MIME }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
