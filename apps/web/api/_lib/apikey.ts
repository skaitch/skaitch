import { getAdminDb } from './admin.js';

/** Returns the uid owning this SKAITCH API key, or null. */
export async function authenticateKey(apiKey: string): Promise<string | null> {
  if (!apiKey || !apiKey.startsWith('ak_') || apiKey.includes('/')) return null;
  const db = getAdminDb();
  const match = /^ak_([^/]+)_[a-f0-9]{40}$/.exec(apiKey);
  if (match) {
    const snap = await db.doc(`users/${match[1]}/apiKeys/${apiKey}`).get();
    return snap.exists ? match[1] : null;
  }
  // Older keys did not embed the owner uid.
  const snap = await db.collectionGroup('apiKeys').where('id', '==', apiKey).get();
  return snap.empty ? null : snap.docs[0].data().uid || null;
}
