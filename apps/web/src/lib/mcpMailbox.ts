import { runTransaction, type DocumentReference } from 'firebase/firestore';
import { db } from './firebase';

/** A Firestore transaction lets only one editor consume a live request. */
export function claimMcpRequest(ref: DocumentReference) {
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists() || snapshot.data().claimed) return false;
    const age = Date.now() - Date.parse(snapshot.data().createdAt);
    if (!Number.isFinite(age) || age < -5000 || age > 120_000) return false;
    tx.update(ref, { claimed: true });
    return true;
  });
}
