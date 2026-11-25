/** Maximum number of projects a web (beta) account may create. The desktop app has no limit. */
export const WEB_PROJECT_LIMIT = 3;

/** True when an account holding `count` projects may add one more. `limit` undefined means unlimited. */
export function canAddProject(count: number, limit: number | undefined): boolean {
  return limit === undefined || count < limit;
}

export const PROJECT_LIMIT_MESSAGE = 'Project limit reached ({limit} projects during the beta, archived included). Delete a project to create a new one.';
