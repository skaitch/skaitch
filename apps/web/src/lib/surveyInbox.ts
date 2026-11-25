import type { ReceivedSurvey, SurveyInbox } from '@skaitch/ui/platform';
import { auth } from './firebase';

/** Web side of the account inbox (ADR 0011): calls /api/survey with the Firebase session. */
async function call(operation: string, payload: unknown = {}): Promise<Response> {
  const user = auth.currentUser;
  if (!user) throw new Error('Connectez-vous pour recevoir des relevés.');
  const res = await fetch(`/api/survey?operation=${operation}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Service d’envoi indisponible (${res.status}).`);
  return res;
}
const json = async <T,>(op: string, payload?: unknown) => (await call(op, payload)).json() as Promise<T>;

export const webSurveyInbox: SurveyInbox = {
  list: () => json('list'),
  async download(survey: ReceivedSurvey) {
    // The file is read back piece by piece, as it was sent.
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let index = 0; total < survey.bytes; index++) {
      const bytes = new Uint8Array(await (await call('read-chunk', { id: survey.id, index })).arrayBuffer());
      if (!bytes.length) break;
      parts.push(bytes);
      total += bytes.length;
    }
    const file = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { file.set(p, at); at += p.length; }
    return file;
  },
  remove: async id => { await call('delete', { id }); },
  listKeys: () => json('key-list'),
  createKey: name => json('key-create', { name }),
  revokeKey: async id => { await call('key-delete', { id }); },
};
