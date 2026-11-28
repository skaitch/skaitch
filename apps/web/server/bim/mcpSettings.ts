import { getAdminDb } from '../../api/_lib/admin.js';
import { InputError } from '@skaitch/core/bim/validation';
import { LANGUAGES } from '@skaitch/core/data/i18n';

export async function mcpSettings(uid: string, data: Record<string, unknown>) {
  const ref = getAdminDb().doc(`users/${uid}/metadata/mcp`);
  if (data.action === 'get') {
    const snapshot = await ref.get();
    return { enabled: true, alwaysValidate: false, revision: 0, ...snapshot.data() };
  }
  if (data.action !== 'set' || typeof data.enabled !== 'boolean' || typeof data.alwaysValidate !== 'boolean' || !Number.isSafeInteger(data.expectedRevision)
    || data.lang !== undefined && !LANGUAGES.some(({ code }) => code === data.lang)) throw new InputError('Réglages MCP invalides.');
  return getAdminDb().runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    const revision = snapshot.data()?.revision ?? 0;
    if (data.expectedRevision !== revision) throw new InputError('Les réglages MCP ont changé dans une autre session. Rechargez-les.', 409);
    // The interface language names elements the cloud MCP creates on its own; keep the saved one when absent.
    const lang = data.lang ?? snapshot.data()?.lang;
    const settings = { enabled: data.enabled, alwaysValidate: data.alwaysValidate, revision: revision + 1, ...(lang ? { lang } : {}) };
    tx.set(ref, settings);
    return settings;
  });
}
