import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, signInWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { doc, getFirestore, setDoc } from 'firebase/firestore';
import { randomBytes, randomUUID } from 'node:crypto';

/** Isolated authentication per request: never share a signed-in user between requests. */
export async function createAccountGrant(email: string, password: string, access: 'read' | 'write', googleIdToken?: string): Promise<string> {
  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  }, `oauth-${randomUUID()}`);
  try {
    const auth = getAuth(app);
    const { user } = googleIdToken
      ? await signInWithCredential(auth, GoogleAuthProvider.credential(googleIdToken))
      : await signInWithEmailAndPassword(auth, email, password);
    const db = getFirestore(app);
    const id = `ak_${user.uid}_${randomBytes(20).toString('hex')}`;
    // Keep the account grant visible and revocable.
    await setDoc(doc(db, 'users', user.uid, 'apiKeys', id), {
      id, uid: user.uid, name: 'Connexion OAuth',
      createdAt: new Date().toISOString(), permissions: {}, accountAccess: access,
    });
    await signOut(auth);
    return id;
  } finally {
    await deleteApp(app);
  }
}
