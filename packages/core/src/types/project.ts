import type { ElementDef } from '../data/elementCatalogue.js';
import type { ItemsMap } from './ifc.js';

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  thumbnailSvg?: string;
  modelRevision?: number;
  /** When the user archived the project (CONTEXT.md: Archived project); absent or null when active. */
  archivedAt?: string | null;
}

export interface Project extends ProjectMeta {
  items: ItemsMap;
  catalogue?: ElementDef[];
}
