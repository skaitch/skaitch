/** Administrators are listed by Firebase uid in SKAITCH_ADMIN_UIDS (comma, space or semicolon separated). */
export function isAdministrator(uid: string | null | undefined, list = process.env.SKAITCH_ADMIN_UIDS): boolean {
  if (!uid) return false;
  return (list || '').split(/[\s,;]+/).filter(Boolean).includes(uid);
}
