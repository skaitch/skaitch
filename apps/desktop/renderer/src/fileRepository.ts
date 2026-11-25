import { jsonEqual } from '@skaitch/core/lib/jsonEqual';
import type { ProjectRepository, StoredProject } from '@skaitch/core/lib/projectRepository';

/** Projects stored as .skaitch files in the desktop project library (main process). */
export function libraryProjectRepository(): ProjectRepository {
  const library = window.skaitchDesktop.library;
  const bases = new Map<string, StoredProject>();
  const writes = new Map<string, Promise<unknown>>();
  return {
    list: () => library.list(),
    async read(id) {
      await writes.get(id)?.catch(() => {});
      const stored = await library.read(id);
      if (stored) bases.set(id, stored); else bases.delete(id);
      return stored;
    },
    write(id, patch) {
      // Saves of one project run in order, like the web repository.
      const pending = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const stored = await library.write(id, patch);
        bases.set(id, stored);
        return stored;
      });
      writes.set(id, pending);
      return pending.finally(() => { if (writes.get(id) === pending) writes.delete(id); });
    },
    async delete(id) {
      await library.delete(id);
      bases.delete(id);
    },
    async setArchived(id, archived) {
      await writes.get(id)?.catch(() => {});
      return library.setArchived(id, archived);
    },
    isSaved(id, items, catalogue) {
      const base = bases.get(id);
      if (catalogue && !jsonEqual(base?.catalogue, catalogue)) return false;
      return base?.itemsJson === JSON.stringify(items);
    },
    // Library files are only changed by this app window for now.
    watch: () => () => {},
  };
}
