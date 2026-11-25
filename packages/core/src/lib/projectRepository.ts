import type { ElementDef } from '../data/elementCatalogue.js';
import type { ItemsMap } from '../types/ifc.js';
import type { ProjectMeta } from '../types/project.js';

/** A project as persisted: metadata plus the serialized model. */
export type StoredProject = ProjectMeta & { itemsJson: string; catalogue?: ElementDef[] };

/**
 * Where projects live. The web app backs it with the signed-in user's Firestore
 * space; the desktop app will back it with local project files (ADR 0002, 0003).
 * An instance is already bound to its owner, so callers never pass an account.
 */
export interface ProjectRepository {
  list(): Promise<ProjectMeta[]>;
  read(id: string): Promise<StoredProject | null>;
  /** Merges `patch` into the stored project and returns what was saved. */
  write(id: string, patch: Partial<StoredProject>): Promise<StoredProject>;
  delete(id: string): Promise<void>;
  /** Archives or unarchives a project (ADR 0020) and returns its updated metadata. */
  setArchived(id: string, archived: boolean): Promise<ProjectMeta>;
  /** True when `items` (and `catalogue`, if given) match the last read or saved version. */
  isSaved(id: string, items: ItemsMap, catalogue?: ElementDef[]): boolean;
  /**
   * Reports newer versions saved elsewhere. Must not overwrite unsaved local edits:
   * call `fail` instead when the local model diverged. Returns an unsubscribe function.
   */
  watch(id: string, getItems: () => ItemsMap, receive: (project: StoredProject) => void, fail: (error: Error) => void): () => void;
}
