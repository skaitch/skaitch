import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

/** Server credentials only; browser Firebase rules remain unchanged. */
function getAdminApp() {
  let app = getApps().find(app => app.name === 'skaitch-mcp');
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('Firebase project is not configured');
    if (raw) {
      const account = JSON.parse(raw);
      if (!account.project_id || !account.client_email || !account.private_key || account.project_id !== projectId) {
        throw new Error('Invalid Firebase service account or project mismatch');
      }
      app = initializeApp({ credential: cert(account), projectId }, 'skaitch-mcp');
    } else {
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS');
      app = initializeApp({ credential: applicationDefault(), projectId }, 'skaitch-mcp');
    }
  }
  return app;
}
export function getAdminDb() { return getFirestore(getAdminApp()); }
export function getAdminAuth() { return getAuth(getAdminApp()); }
