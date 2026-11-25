import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { ElementDef } from '../data/elementCatalogue.js';
import type { ItemsMap } from '../types/ifc.js';

/**
 * The `.skaitch` project file (ADR 0003): a ZIP archive that carries one complete
 * project between the web app and the desktop app.
 *
 *   manifest.json   format marker, formatVersion, app version, project metadata
 *   model.json      the model items; background plan images are referenced, not inlined
 *   catalogue.json  project element definitions (optional)
 *   source.ifc      the original IFC the project was imported from (optional)
 *   plans/*         background plan images, one per storey, and for vector background plans
 *                   their normalized geometry as `plans/<storey>.vector.json` (ADR 0014)
 */
export const SKAITCH_FORMAT = 'skaitch';
export const SKAITCH_FORMAT_VERSION = 1;
export const SKAITCH_EXTENSION = '.skaitch';
export const SKAITCH_MIME = 'application/vnd.skaitch+zip';

/** Refuse archives whose content would expand beyond this (zip bomb guard). */
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;

export interface SkaitchProjectMeta {
  /** Stable project id, written by apps that keep a project library; absent in exported files. */
  id?: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkaitchProject {
  meta: SkaitchProjectMeta;
  items: ItemsMap;
  catalogue?: ElementDef[];
  /** Bytes of the IFC the project was imported from, kept so IFC patching can start from it. */
  sourceIfc?: Uint8Array;
}

interface Manifest {
  format: typeof SKAITCH_FORMAT;
  formatVersion: number;
  appVersion: string;
  project: SkaitchProjectMeta;
}

/** Parsed archive content before migration to the current format version. */
interface Contents {
  manifest: Manifest;
  model: ItemsMap;
  catalogue?: ElementDef[];
}

/**
 * One entry per past format version: MIGRATIONS[n] upgrades version n content to n + 1.
 * Add an entry here whenever SKAITCH_FORMAT_VERSION is bumped; never edit a shipped one.
 */
const MIGRATIONS: Record<number, (contents: Contents) => Contents> = {};

export class SkaitchFileError extends Error {}

const PLAN_REF = /^plans\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/;
const VECTOR_REF = /^plans\/[A-Za-z0-9_-]+\.vector\.json$/;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const EXTENSION = { png: 'png', jpeg: 'jpg', webp: 'webp' } as const;
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Moves inlined plan images and vector geometry out of the model; returns the model to store and the plan files. */
function extractPlans(items: ItemsMap) {
  const model: ItemsMap = {};
  const plans: Record<string, Uint8Array> = {};
  for (const [id, item] of Object.entries(items)) {
    const plan = (item as any)?.geom?.plan;
    const url = plan?.url;
    const match = typeof url === 'string' ? DATA_URL.exec(url) : null;
    const vector = plan?.vector && typeof plan.vector === 'object' ? plan.vector : null;
    if (!match && !vector) { model[id] = item; continue; }
    const base = `plans/${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const next = { ...plan };
    if (match) {
      const path = `${base}.${EXTENSION[match[1] as keyof typeof EXTENSION]}`;
      if (plans[path]) throw new SkaitchFileError(`Deux étages produisent le même fichier de plan : ${path}`);
      plans[path] = base64ToBytes(match[2]);
      next.url = path;
    }
    if (vector) {
      const path = `${base}.vector.json`;
      if (plans[path]) throw new SkaitchFileError(`Deux étages produisent le même fichier de plan : ${path}`);
      plans[path] = json(vector);
      next.vector = path;
    }
    model[id] = { ...item, geom: { ...(item as any).geom, plan: next } } as typeof item;
  }
  return { model, plans };
}

/** Puts plan images back into the model as data URLs, the form the apps render, and vector geometry as objects. */
function inlinePlans(model: ItemsMap, files: Record<string, Uint8Array>) {
  const items: ItemsMap = {};
  for (const [id, item] of Object.entries(model)) {
    const plan = (item as any)?.geom?.plan;
    const url = plan?.url;
    const vector = plan?.vector;
    const urlRef = typeof url === 'string' && !url.startsWith('data:');
    const vectorRef = typeof vector === 'string';
    if (!urlRef && !vectorRef) { items[id] = item; continue; }
    const next = { ...plan };
    if (urlRef) {
      if (!PLAN_REF.test(url) || !files[url]) throw new SkaitchFileError(`Fond de plan manquant dans le fichier : ${url}`);
      const mime = MIME[url.slice(url.lastIndexOf('.') + 1) as keyof typeof MIME];
      next.url = `data:${mime};base64,${bytesToBase64(files[url])}`;
    }
    if (vectorRef) {
      if (!VECTOR_REF.test(vector) || !files[vector]) throw new SkaitchFileError(`Fond de plan vectoriel manquant dans le fichier : ${vector}`);
      next.vector = parseJson(files, vector);
    }
    items[id] = { ...item, geom: { ...(item as any).geom, plan: next } } as typeof item;
  }
  return items;
}

const json = (value: unknown) => strToU8(JSON.stringify(value));

export function writeSkaitchFile(project: SkaitchProject, appVersion: string): Uint8Array {
  const { model, plans } = extractPlans(project.items);
  const manifest: Manifest = { format: SKAITCH_FORMAT, formatVersion: SKAITCH_FORMAT_VERSION, appVersion, project: project.meta };
  const files: Zippable = { 'manifest.json': json(manifest), 'model.json': json(model) };
  if (project.catalogue?.length) files['catalogue.json'] = json(project.catalogue);
  // Images and IFC are stored as-is: PNG/JPEG are already compressed. Vector geometry is JSON and compresses well.
  for (const [path, bytes] of Object.entries(plans)) files[path] = VECTOR_REF.test(path) ? bytes : [bytes, { level: 0 }];
  if (project.sourceIfc) files['source.ifc'] = project.sourceIfc;
  return zipSync(files, { level: 6 });
}

function parseJson<T>(files: Record<string, Uint8Array>, path: string): T {
  try { return JSON.parse(strFromU8(files[path])); }
  catch { throw new SkaitchFileError(`Fichier ${path} illisible.`); }
}

export function readSkaitchFile(bytes: Uint8Array): SkaitchProject {
  let unpacked = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: file => {
        unpacked += file.originalSize;
        if (unpacked > MAX_UNPACKED_BYTES) throw new SkaitchFileError('Fichier .skaitch trop volumineux.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SkaitchFileError) throw error;
    throw new SkaitchFileError('Ce fichier n’est pas un projet .skaitch valide.');
  }
  if (!files['manifest.json'] || !files['model.json']) throw new SkaitchFileError('Ce fichier n’est pas un projet .skaitch valide.');
  const manifest = parseJson<Manifest>(files, 'manifest.json');
  if (manifest?.format !== SKAITCH_FORMAT || !Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 1) {
    throw new SkaitchFileError('Ce fichier n’est pas un projet .skaitch valide.');
  }
  if (manifest.formatVersion > SKAITCH_FORMAT_VERSION) {
    throw new SkaitchFileError('Ce projet a été enregistré par une version plus récente de skAItch. Mettez l’application à jour pour l’ouvrir.');
  }
  let contents: Contents = {
    manifest,
    model: parseJson<ItemsMap>(files, 'model.json'),
    catalogue: files['catalogue.json'] ? parseJson<ElementDef[]>(files, 'catalogue.json') : undefined,
  };
  for (let version = manifest.formatVersion; version < SKAITCH_FORMAT_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new SkaitchFileError(`Migration du format .skaitch ${version} manquante.`);
    contents = migrate(contents);
  }
  if (!contents.model || typeof contents.model !== 'object' || Array.isArray(contents.model)) throw new SkaitchFileError('Modèle du projet invalide.');
  const meta = contents.manifest.project ?? {} as SkaitchProjectMeta;
  return {
    meta: {
      ...(typeof meta.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(meta.id) ? { id: meta.id } : {}),
      name: typeof meta.name === 'string' && meta.name.trim() ? meta.name : 'Projet importé',
      description: typeof meta.description === 'string' ? meta.description : '',
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : '',
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : '',
    },
    items: inlinePlans(contents.model, files),
    ...(Array.isArray(contents.catalogue) ? { catalogue: contents.catalogue } : {}),
    ...(files['source.ifc'] ? { sourceIfc: files['source.ifc'] } : {}),
  };
}
