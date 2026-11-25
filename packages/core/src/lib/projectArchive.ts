/** Archived projects (ADR 0020): hidden from the home page's main list and from MCP list_projects by default. */
export const isArchived = (project: { archivedAt?: string | null }) => !!project.archivedAt;

/** What list_projects returns: active projects only, unless the caller asks for archived ones too. */
export function listedProjects<T extends { archivedAt?: string | null }>(projects: T[], args: { includeArchived?: unknown } = {}): T[] {
  return args.includeArchived === true ? projects : projects.filter(project => !isArchived(project));
}
