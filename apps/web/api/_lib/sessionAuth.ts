import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/** Verify the browser's Firebase ID token against this deployment's project. */
export async function authenticateSession(authorization: unknown): Promise<string | null> {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Firebase project is not configured');
  const app = getApps().find(app => app.name === 'skaitch-browser-auth')
    ?? initializeApp({ projectId }, 'skaitch-browser-auth');
  try {
    const token = await getAuth(app).verifyIdToken(authorization.slice(7));
    return token.uid;
  } catch { return null; }
}
